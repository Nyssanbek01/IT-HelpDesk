import { ticketList } from '../tickets/list.js'
import { Prisma } from '@prisma/client'
import { Router } from 'express'
import { prisma } from '../db/prisma.js'
import { authenticateToken } from '../middleware/authenticateToken.js'
import { findAccessibleTicket } from '../tickets/access.js'
import { moveToTrash, removeTrashFile, restoreFromTrash } from '../files/storage.js'
import { notifyTicket } from '../notifications/service.js'
import { deadlines, slaClock, withSla } from '../sla/service.js'

const router = Router()
const priorities = ['low', 'medium', 'high'] as const

router.use(authenticateToken)

router.post('/', async (request, response) => {
  const authUser = request.authUser
  const body = request.body as Record<string, unknown> | undefined
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const priority = typeof body?.priority === 'string' ? body.priority : ''

  if (!authUser) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }
  if (!title || !description) {
    response.status(400).json({ message: 'Title and description are required' })
    return
  }
  if (!priorities.includes(priority as (typeof priorities)[number])) {
    response.status(400).json({ message: 'Priority must be low, medium, or high' })
    return
  }
  if (body && ['responseDueAt', 'resolutionDueAt', 'firstRespondedAt', 'resolvedAt', 'slaTrackedFromCreation', 'sla'].some((key) => key in body)) {
    response.status(400).json({ message: 'SLA fields are managed by the server' })
    return
  }

  try {
    const ticket = await prisma.$transaction(async (transaction) => {
      const createdAt = slaClock.now()
      const created = await transaction.ticket.create({
        data: {
          title,
          description,
          priority,
          status: 'new',
          userId: authUser.userId,
          createdAt,
          ...deadlines(priority, createdAt),
        },
      })
      await transaction.ticketHistory.create({
        data: {
          ticketId: created.id,
          actorId: authUser.userId,
          action: 'ticket_created',
          oldValue: null,
          newValue: 'new',
        },
      })
      await notifyTicket(transaction, created, authUser.userId, 'ticket_created')
      return created
    })
    response.status(201).json(withSla(ticket))
  } catch {
    response.status(500).json({ message: 'Unable to create ticket' })
  }
})

router.get('/', ticketList('own'))

router.get('/:id', async (request, response) => {
  const authUser = request.authUser
  const id = Number(request.params.id)
  if (!authUser) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(404).json({ message: 'Ticket not found' })
    return
  }

  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, userId: authUser.userId },
    })
    if (!ticket) {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    response.json(withSla(ticket))
  } catch {
    response.status(500).json({ message: 'Unable to load ticket' })
  }
})

router.delete('/:id', async (request, response) => {
  const authUser = request.authUser
  const id = Number(request.params.id)
  if (!authUser) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(404).json({ message: 'Ticket not found' })
    return
  }

  const stagedFiles: Array<{ storageKey: string; trashPath: string | null }> = []
  try {
    const outcome = await prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Ticket" WHERE "id" = ${id} AND "userId" = ${authUser.userId} FOR UPDATE
      `
      if (locked.length === 0) return { kind: 'missing' as const }

      const attachments = await transaction.ticketAttachment.findMany({
        where: { ticketId: id },
        select: { storageKey: true },
      })
      for (const attachment of attachments) {
        stagedFiles.push({ storageKey: attachment.storageKey, trashPath: await moveToTrash(attachment.storageKey) })
      }

      const result = await transaction.ticket.deleteMany({ where: { id, userId: authUser.userId } })
      return result.count === 1 ? { kind: 'deleted' as const } : { kind: 'missing' as const }
    })
    if (outcome.kind === 'missing') {
      await Promise.all(stagedFiles.map((file) => restoreFromTrash(file.trashPath, file.storageKey).catch(() => undefined)))
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    await Promise.all(stagedFiles.map((file) => removeTrashFile(file.trashPath).catch(() => undefined)))
    response.status(204).end()
  } catch (error) {
    await Promise.all(stagedFiles.map((file) => restoreFromTrash(file.trashPath, file.storageKey).catch(() => undefined)))
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    response.status(500).json({ message: 'Unable to delete ticket' })
  }
})

router.get('/:id/comments', async (request, response) => {
  const authUser = request.authUser
  const id = Number(request.params.id)
  if (!authUser) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(404).json({ message: 'Ticket not found' })
    return
  }

  try {
    const ticket = await findAccessibleTicket(request, id)
    if (!ticket) {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    const comments = await prisma.ticketComment.findMany({
      where: { ticketId: ticket.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        message: true,
        ticketId: true,
        createdAt: true,
        user: { select: { id: true, name: true, role: true } },
      },
    })
    response.json(comments)
  } catch {
    response.status(500).json({ message: 'Unable to load comments' })
  }
})

router.post('/:id/comments', async (request, response) => {
  const authUser = request.authUser
  const id = Number(request.params.id)
  const body = request.body as Record<string, unknown> | undefined
  const message = typeof body?.message === 'string' ? body.message.trim() : ''

  if (!authUser) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(404).json({ message: 'Ticket not found' })
    return
  }
  if (!message) {
    response.status(400).json({ message: 'Comment message is required' })
    return
  }
  if (message.length > 2000) {
    response.status(400).json({ message: 'Comment message must not exceed 2000 characters' })
    return
  }

  try {
    const ticket = await findAccessibleTicket(request, id)
    if (!ticket) {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    const comment = await prisma.$transaction(async (transaction) => {
      const current = await transaction.ticket.findUnique({ where: { id: ticket.id } })
      if (!current) throw new Error('Ticket disappeared')
      const created = await transaction.ticketComment.create({
        data: {
          message,
          ticketId: ticket.id,
          userId: authUser.userId,
        },
        select: {
          id: true,
          message: true,
          ticketId: true,
          createdAt: true,
          user: { select: { id: true, name: true, role: true } },
        },
      })
      await notifyTicket(transaction, current, authUser.userId, 'new_comment')
      return created
    })
    response.status(201).json(comment)
  } catch {
    response.status(500).json({ message: 'Unable to create comment' })
  }
})

router.get('/:id/history', async (request, response) => {
  const authUser = request.authUser
  const id = Number(request.params.id)
  if (!authUser) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(404).json({ message: 'Ticket not found' })
    return
  }

  try {
    const ticket = await findAccessibleTicket(request, id)
    if (!ticket) {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    const history = await prisma.ticketHistory.findMany({
      where: { ticketId: ticket.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        ticketId: true,
        actorId: true,
        action: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
        actor: { select: { id: true, name: true, role: true } },
      },
    })
    response.json(history)
  } catch {
    response.status(500).json({ message: 'Unable to load ticket history' })
  }
})

export default router
