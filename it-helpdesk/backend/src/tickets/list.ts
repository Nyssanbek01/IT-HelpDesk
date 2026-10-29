import { Prisma } from '@prisma/client'
import type { RequestHandler } from 'express'
import { prisma } from '../db/prisma.js'
import { slaClock, slaPolicy, slaStatuses, withSla, type SlaStatus } from '../sla/service.js'

type Scope = 'own' | 'engineer' | 'admin'
const sortFields = ['createdAt', 'updatedAt', 'priority', 'resolutionDueAt', 'nearestDeadline'] as const
const allowed = new Set(['search', 'status', 'priority', 'assignedEngineerId', 'dateFrom', 'dateTo', 'slaStatus', 'slaStage', 'sortBy', 'sortOrder', 'page', 'limit', 'pageSize', 'sort'])
const include = { user: { select: { id: true, name: true, email: true } }, assignedEngineer: { select: { id: true, name: true, email: true } } } as const

function dateBoundary(value: string, end: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date must use YYYY-MM-DD')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date')
  return new Date(+date + (end ? 86400000 : 0))
}

export function parseTicketQuery(query: Record<string, unknown>, scope: Scope) {
  if (Object.keys(query).some((key) => !allowed.has(key)) || Object.values(query).some((value) => typeof value !== 'string')) throw new Error('Invalid query parameters')
  const q = query as Record<string, string>
  if ((q.limit && q.pageSize) || (q.sort && q.sortBy) || (scope !== 'admin' && q.pageSize !== undefined) || (scope === 'own' && q.assignedEngineerId !== undefined)) throw new Error('Unsupported query parameter combination')
  const integer = (value: string, maximum: number) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= maximum
  const page = q.page ?? '1', limit = q.limit ?? q.pageSize ?? '10'
  if (!integer(page, 1_000_000) || !integer(limit, 100) || (q.pageSize === undefined && !['10', '20', '50'].includes(limit))) throw new Error('Invalid pagination')
  const search = (q.search ?? '').trim()
  if ((q.search?.length ?? 0) > 100) throw new Error('Search exceeds 100 characters')
  if (q.status !== undefined && !['all', 'new', 'in_progress', 'resolved'].includes(q.status)) throw new Error('Invalid status')
  if (q.priority !== undefined && !['all', 'low', 'medium', 'high'].includes(q.priority)) throw new Error('Invalid priority')
  const slaStatus = q.slaStatus ?? 'all', slaStage = q.slaStage ?? 'any'
  if (slaStatus !== 'all' && !slaStatuses.includes(slaStatus as SlaStatus)) throw new Error('Invalid SLA status')
  if (!['any', 'response', 'resolution'].includes(slaStage)) throw new Error('Invalid SLA stage')
  if (q.sort && !['newest', 'resolutionDueAt'].includes(q.sort)) throw new Error('Invalid legacy sort')
  const sortBy = q.sortBy ?? (q.sort === 'resolutionDueAt' ? 'nearestDeadline' : 'createdAt')
  const sortOrder = q.sortOrder ?? (sortBy === 'nearestDeadline' || sortBy === 'resolutionDueAt' ? 'asc' : 'desc')
  if (!sortFields.includes(sortBy as typeof sortFields[number]) || !['asc', 'desc'].includes(sortOrder)) throw new Error('Invalid sort')
  const assigned = q.assignedEngineerId
  if (assigned !== undefined && !['all', 'unassigned', 'me'].includes(assigned) && !integer(assigned, 2147483647)) throw new Error('Invalid engineer')
  const from = q.dateFrom ? dateBoundary(q.dateFrom, false) : undefined
  const to = q.dateTo ? dateBoundary(q.dateTo, true) : undefined
  if ((q.dateFrom !== undefined && !q.dateFrom) || (q.dateTo !== undefined && !q.dateTo) || (from && to && +from >= +to)) throw new Error('Invalid date range')
  return { page: Number(page), limit: Number(limit), skip: (Number(page) - 1) * Number(limit), search, status: q.status, priority: q.priority, assigned, from, to, slaStatus, slaStage, sortBy, sortOrder: sortOrder as Prisma.SortOrder }
}

// All time-dependent SLA predicates execute in PostgreSQL, before count/skip/take.
export function slaWhere(status: string, stage: string, now: Date): Prisma.TicketWhereInput {
  if (status === 'all') return {}
  if (stage === 'any') return { OR: [slaWhere(status, 'response', now), slaWhere(status, 'resolution', now)] }
  const response = stage === 'response'
  const due = response ? 'responseDueAt' : 'resolutionDueAt'
  const completed = response ? 'firstRespondedAt' : 'resolvedAt'
  const reference = response ? prisma.ticket.fields.responseDueAt : prisma.ticket.fields.resolutionDueAt
  if (status === 'unknown') return { OR: [{ [due]: null }, ...(response ? [{ slaTrackedFromCreation: false }] : []), { status: 'resolved', [completed]: null }] }
  const known: Prisma.TicketWhereInput = { [due]: { not: null }, ...(response ? { slaTrackedFromCreation: true } : {}) }
  if (status === 'met' || status === 'breached') return { AND: [known, { [completed]: { [status === 'met' ? 'lte' : 'gt']: reference } }] }
  const pending: Prisma.TicketWhereInput = { AND: [known, { status: { not: 'resolved' }, [completed]: null }] }
  if (status === 'overdue') return { AND: [pending, { [due]: { lte: now } }] }
  return { AND: [pending, { OR: Object.entries(slaPolicy).map(([priority, policy]) => {
    const threshold = Math.max(policy[response ? 'response' : 'resolution'] * .2, 300000)
    const boundary = new Date(+now + threshold)
    return { priority, [due]: status === 'on_time' ? { gt: boundary } : { gt: now, lte: boundary } }
  }) }] }
}

export function ticketList(scope: Scope): RequestHandler {
  return async (request, response) => {
    let query: ReturnType<typeof parseTicketQuery>
    try { query = parseTicketQuery(request.query as Record<string, unknown>, scope) }
    catch (error) { response.status(400).json({ message: error instanceof Error ? error.message : 'Invalid query' }); return }
    const userId = request.authUser!.userId
    if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) { response.status(401).json({ message: 'Authentication required' }); return }
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
      if (!user) { response.status(401).json({ message: 'Authentication required' }); return }
      if (!['user', 'engineer', 'admin'].includes(user.role)) { response.status(403).json({ message: 'Access denied' }); return }
      if ((scope === 'engineer' && !['engineer', 'admin'].includes(user.role)) || (scope === 'admin' && user.role !== 'admin')) { response.status(403).json({ message: 'Access denied' }); return }
      const access: Prisma.TicketWhereInput = scope === 'own' ? { userId } : {}
      const now = slaClock.now()
      const filters: Prisma.TicketWhereInput[] = [access, slaWhere(query.slaStatus, query.slaStage, now)]
      if (query.status && query.status !== 'all') filters.push({ status: query.status })
      if (query.priority && query.priority !== 'all') filters.push({ priority: query.priority })
      if (query.assigned && query.assigned !== 'all') filters.push({ assignedEngineerId: query.assigned === 'unassigned' ? null : query.assigned === 'me' ? userId : Number(query.assigned) })
      if (query.from || query.to) filters.push({ createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } })
      if (query.search) {
        const id = /^#?\d+$/.test(query.search) ? Number(query.search.replace('#', '')) : NaN
        const text = query.search.replace(/[\\%_]/g, '\\$&')
        const search: Prisma.TicketWhereInput[] = [{ title: { contains: text, mode: 'insensitive' } }, { description: { contains: text, mode: 'insensitive' } }]
        // Preserve the earlier admin search by author/engineer, without widening scope.
        if (scope === 'admin') search.push({ user: { name: { contains: text, mode: 'insensitive' } } }, { user: { email: { contains: text, mode: 'insensitive' } } }, { assignedEngineer: { name: { contains: text, mode: 'insensitive' } } }, { assignedEngineer: { email: { contains: text, mode: 'insensitive' } } })
        if (Number.isSafeInteger(id) && id > 0 && id <= 2147483647) search.push({ id })
        filters.push({ OR: search })
      }
      const where: Prisma.TicketWhereInput = { AND: filters }
      const result = await prisma.$transaction(async (transaction) => {
        const total = await transaction.ticket.count({ where })
        const orderBy: Prisma.TicketOrderByWithRelationInput[] = query.sortBy === 'resolutionDueAt' || query.sortBy === 'nearestDeadline'
          ? [{ resolutionDueAt: { sort: query.sortOrder, nulls: 'last' } }, { id: query.sortOrder }]
          : query.sortBy === 'priority' ? [{ id: query.sortOrder }] : [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }]
        // Semantic priority and active-first urgency use bounded SQL buckets, never table materialization.
        let buckets: Prisma.TicketWhereInput[] = [{}]
        if (query.sortBy === 'priority') {
          const priorities = query.sortOrder === 'asc' ? ['low', 'medium', 'high'] : ['high', 'medium', 'low']
          buckets = [...priorities.map((priority) => ({ priority })), { priority: { notIn: priorities } }]
        } else if (query.sortBy === 'nearestDeadline') buckets = [{ status: { not: 'resolved' } }, { status: 'resolved' }]
        const items: Prisma.TicketGetPayload<{ include: typeof include }>[] = []
        let skip = query.skip, remaining = query.limit
        for (const bucket of buckets) {
          if (remaining <= 0) break
          const bucketWhere = { AND: [where, bucket] }
          if (buckets.length > 1) {
            const size = await transaction.ticket.count({ where: bucketWhere })
            if (skip >= size) { skip -= size; continue }
          }
          const rows = await transaction.ticket.findMany({ where: bucketWhere, include, orderBy, skip, take: remaining })
          items.push(...rows); remaining -= rows.length; skip = 0
        }
        const groups = await transaction.ticket.groupBy({ by: ['status'], where: access, _count: { _all: true } })
        const summary = { total: groups.reduce((sum, group) => sum + group._count._all, 0), new: 0, in_progress: 0, resolved: 0, assignedToMe: await transaction.ticket.count({ where: { AND: [access, { assignedEngineerId: userId }] } }) }
        for (const group of groups) if (group.status === 'new' || group.status === 'in_progress' || group.status === 'resolved') summary[group.status] = group._count._all
        return { items: items.map((ticket) => withSla(ticket, now)), total, summary }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
      response.setHeader('Cache-Control', 'no-store')
      response.json({ ...result, page: query.page, limit: query.limit, pageSize: query.limit, totalPages: Math.ceil(result.total / query.limit) })
    } catch { response.status(500).json({ message: 'Unable to load tickets' }) }
  }
}
