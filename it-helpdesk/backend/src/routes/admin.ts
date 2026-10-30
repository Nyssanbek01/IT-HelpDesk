import { ticketList } from '../tickets/list.js'
import analyticsRouter from './analytics.js'
import { Prisma } from '@prisma/client'
import { Router } from 'express'
import { prisma } from '../db/prisma.js'
import { authenticateToken } from '../middleware/authenticateToken.js'
import { requireRole } from '../middleware/requireRole.js'
import { notifyTicket } from '../notifications/service.js'
import { slaStatistics, withSla } from '../sla/service.js'

const router = Router()
const roles = ['user', 'engineer', 'admin'] as const
const statuses = ['new', 'in_progress', 'resolved'] as const
const priorities = ['low', 'medium', 'high'] as const
const adminTicketInclude = {
  user: { select: { id: true, name: true, email: true } },
  assignedEngineer: { select: { id: true, name: true, email: true } },
} as const

router.use(authenticateToken, requireRole('admin'))
router.use('/analytics', analyticsRouter)

router.get('/sla/stats', async (request, response) => {
  if (Object.keys(request.query).length) { response.status(400).json({ message: 'SLA stats does not accept query parameters' }); return }
  try { response.json(slaStatistics(await prisma.ticket.findMany())) }
  catch { response.status(500).json({ message: 'Unable to load SLA statistics' }) }
})

function queryString(value: unknown, name: string, maximumLength = 120): { value?: string; error?: string } {
  if (value === undefined) return {}
  if (typeof value !== 'string' || value.length > maximumLength) return { error: `Invalid ${name} query parameter` }
  return { value: value.trim() }
}

function pagination(query: Record<string, unknown>) {
  const pageValue = query.page === undefined ? '1' : query.page
  const pageSizeValue = query.pageSize === undefined ? '25' : query.pageSize
  if (typeof pageValue !== 'string' || typeof pageSizeValue !== 'string') return null
  const page = Number(pageValue)
  const pageSize = Number(pageSizeValue)
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return null
  return { page, pageSize, skip: (page - 1) * pageSize }
}

router.get('/stats', async (_request, response) => {
  try {
    const [totalTickets, newTickets, inProgressTickets, resolvedTickets, totalUsers, engineers, unassignedTickets] = await Promise.all([
      prisma.ticket.count(),
      prisma.ticket.count({ where: { status: 'new' } }),
      prisma.ticket.count({ where: { status: 'in_progress' } }),
      prisma.ticket.count({ where: { status: 'resolved' } }),
      prisma.user.count(),
      prisma.user.count({ where: { role: 'engineer' } }),
      prisma.ticket.count({ where: { assignedEngineerId: null } }),
    ])
    response.json({ totalTickets, newTickets, inProgressTickets, resolvedTickets, totalUsers, engineers, unassignedTickets })
  } catch {
    response.status(500).json({ message: 'Unable to load admin statistics' })
  }
})

router.get('/users', async (request, response) => {
  const page = pagination(request.query as Record<string, unknown>)
  const search = queryString(request.query.search, 'search', 100)
  const role = queryString(request.query.role, 'role', 20)
  if (!page || search.error || role.error || (role.value && role.value !== 'all' && !roles.includes(role.value as (typeof roles)[number]))) {
    response.status(400).json({ message: page ? search.error ?? role.error ?? 'Invalid role filter' : 'Invalid pagination parameters' })
    return
  }

  const where: Prisma.UserWhereInput = {}
  if (role.value && role.value !== 'all') where.role = role.value
  if (search.value) {
    where.OR = [
      { name: { contains: search.value, mode: 'insensitive' } },
      { email: { contains: search.value, mode: 'insensitive' } },
    ]
  }

  try {
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.pageSize,
      }),
      prisma.user.count({ where }),
    ])
    response.json({ items, total, page: page.page, pageSize: page.pageSize, totalPages: Math.ceil(total / page.pageSize) })
  } catch {
    response.status(500).json({ message: 'Unable to load users' })
  }
})

router.patch('/users/:id/role', async (request, response) => {
  const id = Number(request.params.id)
  const body = request.body as Record<string, unknown> | undefined
  const role = body?.role
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(400).json({ message: 'Invalid user id' })
    return
  }
  if (typeof role !== 'string' || !roles.includes(role as (typeof roles)[number])) {
    response.status(400).json({ message: 'Role must be user, engineer, or admin' })
    return
  }

  try {
    const outcome = await prisma.$transaction(async (transaction) => {
      const target = await transaction.user.findUnique({
        where: { id },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      })
      if (!target) return { kind: 'missing' as const }
      if (target.role === role) return { kind: 'updated' as const, user: target }
      if (id === request.authUser?.userId) return { kind: 'self' as const }

      if (target.role === 'admin' && role !== 'admin') {
        const admins = await transaction.user.count({ where: { role: 'admin' } })
        if (admins <= 1) return { kind: 'last_admin' as const }
      }

      if (target.role === 'engineer' && role === 'user') {
        const activeAssignments = await transaction.ticket.count({
          where: { assignedEngineerId: id, status: { not: 'resolved' } },
        })
        if (activeAssignments > 0) return { kind: 'active_assignments' as const, count: activeAssignments }
      }

      const user = await transaction.user.update({
        where: { id },
        data: { role },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      })
      return { kind: 'updated' as const, user }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (outcome.kind === 'missing') {
      response.status(404).json({ message: 'User not found' })
      return
    }
    if (outcome.kind === 'self') {
      response.status(409).json({ message: 'You cannot change your own role' })
      return
    }
    if (outcome.kind === 'last_admin') {
      response.status(409).json({ message: 'At least one admin account must remain' })
      return
    }
    if (outcome.kind === 'active_assignments') {
      response.status(409).json({ message: `Engineer has ${outcome.count} unfinished assigned ticket(s)` })
      return
    }
    response.json(outcome.user)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      response.status(409).json({ message: 'Role update conflicted with another change; retry the request' })
      return
    }
    response.status(500).json({ message: 'Unable to update user role' })
  }
})

router.get('/tickets', ticketList('admin'))

router.get('/tickets/:id', async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(404).json({ message: 'Ticket not found' })
    return
  }
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedEngineer: { select: { id: true, name: true, email: true } },
      },
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

router.patch('/tickets/:id/assign', async (request, response) => {
  const id = Number(request.params.id)
  const body = request.body as Record<string, unknown> | undefined
  const engineerId = body?.engineerId
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(400).json({ message: 'Invalid ticket id' })
    return
  }
  if (engineerId !== null && (typeof engineerId !== 'number' || !Number.isSafeInteger(engineerId) || engineerId < 1)) {
    response.status(400).json({ message: 'engineerId must be a positive integer or null' })
    return
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      if (engineerId !== null) {
        const engineer = await transaction.user.findUnique({ where: { id: engineerId as number }, select: { id: true, role: true } })
        if (!engineer || engineer.role !== 'engineer') return { kind: 'invalid_engineer' as const }
      }

      const current = await transaction.ticket.findUnique({ where: { id }, select: { id: true, assignedEngineerId: true, status: true, updatedAt: true } })
      if (!current) return { kind: 'missing' as const }
      if (current.assignedEngineerId === engineerId) {
        return { kind: 'updated' as const, ticket: await transaction.ticket.findUnique({ where: { id }, include: adminTicketInclude }) }
      }

      const resetToNew = engineerId === null && current.status === 'in_progress'
      const update = await transaction.ticket.updateMany({
        where: { id, assignedEngineerId: current.assignedEngineerId, status: current.status, updatedAt: current.updatedAt },
        data: {
          assignedEngineerId: engineerId as number | null,
          ...(resetToNew ? { status: 'new' } : {}),
        },
      })
      if (update.count === 0) return { kind: 'conflict' as const }

      await transaction.ticketHistory.create({
        data: {
          ticketId: id,
          actorId: request.authUser!.userId,
          action: 'engineer_assigned',
          oldValue: current.assignedEngineerId === null ? null : String(current.assignedEngineerId),
          newValue: engineerId === null ? null : String(engineerId),
        },
      })
      if (resetToNew) {
        await transaction.ticketHistory.create({
          data: {
            ticketId: id,
            actorId: request.authUser!.userId,
            action: 'status_changed',
            oldValue: 'in_progress',
            newValue: 'new',
          },
        })
      }
      const ticket = await transaction.ticket.findUnique({ where: { id }, include: adminTicketInclude })
      if (ticket) await notifyTicket(transaction, ticket, request.authUser!.userId, engineerId === null ? 'ticket_unassigned' : 'ticket_assigned', current.assignedEngineerId)
      return { kind: 'updated' as const, ticket }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.kind === 'invalid_engineer') {
      response.status(400).json({ message: 'The selected user is not an engineer' })
      return
    }
    if (result.kind === 'missing') {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    if (result.kind === 'conflict') {
      response.status(409).json({ message: 'Ticket changed during assignment; refresh and retry' })
      return
    }
    response.json(result.ticket ? withSla(result.ticket) : null)
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      response.status(409).json({ message: 'Ticket changed during assignment; refresh and retry' })
      return
    }
    response.status(500).json({ message: 'Unable to assign ticket' })
  }
})

router.get('/engineers', async (_request, response) => {
  try {
    const engineers = await prisma.user.findMany({
      where: { role: 'engineer' },
      select: {
        id: true,
        name: true,
        email: true,
        _count: { select: { assignedTickets: { where: { status: { not: 'resolved' } } } } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
    response.json(engineers.map(({ _count, ...engineer }) => ({ ...engineer, openAssignedTickets: _count.assignedTickets })))
  } catch {
    response.status(500).json({ message: 'Unable to load engineers' })
  }
})

export default router
