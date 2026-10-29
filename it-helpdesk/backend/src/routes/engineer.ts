import { ticketList } from '../tickets/list.js'
import { Prisma } from '@prisma/client'
import { Router } from 'express'
import { prisma } from '../db/prisma.js'
import { authenticateToken } from '../middleware/authenticateToken.js'
import { requireRole } from '../middleware/requireRole.js'
import { notifyTicket } from '../notifications/service.js'
import { slaClock, withSla } from '../sla/service.js'

const router = Router()
const engineerRoles = ['engineer', 'admin']
const ticketInclude = {
  user: { select: { id: true, name: true, email: true } },
  assignedEngineer: { select: { id: true, name: true, email: true } },
} as const

router.use(authenticateToken, requireRole(...engineerRoles))

router.get('/', ticketList('engineer'))

router.get('/:id', async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(404).json({ message: 'Ticket not found' })
    return
  }

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: ticketInclude,
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

router.patch('/:id/take', async (request, response) => {
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
    const outcome = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${id} FOR UPDATE`
      const previous = await transaction.ticket.findUnique({ where: { id } })
      const result = await transaction.ticket.updateMany({
        where: { id, OR: [{ assignedEngineerId: null }, { assignedEngineerId: authUser.userId }], status: 'new' },
        data: { assignedEngineerId: authUser.userId, status: 'in_progress' },
      })
      if (result.count === 0) {
        const exists = await transaction.ticket.findUnique({ where: { id }, select: { id: true } })
        return { kind: exists ? 'unavailable' as const : 'missing' as const }
      }

      await transaction.ticket.updateMany({
        where: { id, firstRespondedAt: null, slaTrackedFromCreation: true },
        data: { firstRespondedAt: slaClock.now() },
      })

      await transaction.ticketHistory.createMany({
        data: [
          ...(previous?.assignedEngineerId === null ? [{
            ticketId: id,
            actorId: authUser.userId,
            action: 'engineer_assigned',
            oldValue: null,
            newValue: String(authUser.userId),
          }] : []),
          {
            ticketId: id,
            actorId: authUser.userId,
            action: 'status_changed',
            oldValue: 'new',
            newValue: 'in_progress',
          },
        ],
      })
      const ticket = await transaction.ticket.findUnique({ where: { id }, include: ticketInclude })
      if (ticket) await notifyTicket(transaction, ticket, authUser.userId, 'ticket_taken')
      return { kind: 'taken' as const, ticket }
    })

    if (outcome.kind === 'missing') {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    if (outcome.kind === 'unavailable') {
      response.status(409).json({ message: 'Ticket is no longer available to take' })
      return
    }
    response.json(outcome.ticket ? withSla(outcome.ticket) : null)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      response.status(409).json({ message: 'Ticket is no longer available to take' })
      return
    }
    response.status(500).json({ message: 'Unable to take ticket' })
  }
})

router.patch('/:id/resolve', async (request, response) => {
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
    const outcome = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.ticket.findUnique({
        where: { id },
        select: { id: true, status: true, assignedEngineerId: true, resolvedAt: true },
      })
      if (!existing) return { kind: 'missing' as const }
      if (authUser.role !== 'admin' && existing.assignedEngineerId !== authUser.userId) {
        return { kind: 'forbidden' as const }
      }
      if (existing.status === 'resolved') {
        const ticket = await transaction.ticket.findUnique({ where: { id }, include: ticketInclude })
        return { kind: 'resolved' as const, ticket }
      }

      const result = await transaction.ticket.updateMany({
        where: authUser.role === 'admin'
          ? { id, status: existing.status }
          : { id, assignedEngineerId: authUser.userId, status: existing.status },
        data: { status: 'resolved', resolvedAt: existing.resolvedAt ?? slaClock.now() },
      })
      if (result.count === 0) return { kind: 'forbidden' as const }

      await transaction.ticketHistory.create({
        data: {
          ticketId: id,
          actorId: authUser.userId,
          action: 'status_changed',
          oldValue: existing.status,
          newValue: 'resolved',
        },
      })
      const ticket = await transaction.ticket.findUnique({ where: { id }, include: ticketInclude })
      if (ticket) await notifyTicket(transaction, ticket, authUser.userId, 'ticket_resolved')
      return { kind: 'resolved' as const, ticket }
    })

    if (outcome.kind === 'missing') {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    if (outcome.kind === 'forbidden') {
      response.status(403).json({ message: 'This ticket is assigned to another engineer' })
      return
    }
    response.json(outcome.ticket ? withSla(outcome.ticket) : null)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      response.status(409).json({ message: 'Ticket changed while resolving; refresh and retry' })
      return
    }
    response.status(500).json({ message: 'Unable to resolve ticket' })
  }
})

export default router
