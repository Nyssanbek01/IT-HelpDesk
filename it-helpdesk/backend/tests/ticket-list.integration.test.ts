import 'dotenv/config'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test, mock } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../src/db/prisma.js'
import { JWT_SECRET } from '../src/config/auth.js'
import { deadlines, slaClock, slaStatuses, ticketSla } from '../src/sla/service.js'
import ticketsRouter from '../src/routes/tickets.js'
import engineerRouter from '../src/routes/engineer.js'
import adminRouter from '../src/routes/admin.js'

test('Step 12: real PostgreSQL server-side lists, access, SLA predicates and cleanup', async (t) => {
  const now = new Date('2035-01-01T00:00:00Z')
  mock.method(slaClock, 'now', () => now)
  const users: number[] = [], ids: number[] = []
  const snapshot = async () => createHash('sha256').update(JSON.stringify(await Promise.all([
    prisma.user.findMany({ orderBy: { id: 'asc' } }), prisma.ticket.findMany({ orderBy: { id: 'asc' } }), prisma.ticketComment.findMany({ orderBy: { id: 'asc' } }), prisma.ticketHistory.findMany({ orderBy: { id: 'asc' } }), prisma.ticketAttachment.findMany({ orderBy: { id: 'asc' } }), prisma.notification.findMany({ orderBy: { id: 'asc' } }), prisma.ticketSlaEvent.findMany({ orderBy: { id: 'asc' } }),
  ]))).digest('hex')
  const before = await snapshot()
  const app = express(); app.use(express.json()); app.use('/api/tickets', ticketsRouter); app.use('/api/engineer/tickets', engineerRouter); app.use('/api/admin', adminRouter)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
  const roles: Record<number, string> = {}
  async function get(path: string, userId?: number, claimedRole = roles[userId ?? 0]) {
    return fetch(origin + path, { headers: userId ? { Authorization: `Bearer ${jwt.sign({ userId, role: claimedRole }, JWT_SECRET, { algorithm: 'HS256' })}` } : {} })
  }
  try {
    const tag = randomUUID()
    for (const [index, role] of ['user', 'user', 'engineer', 'admin'].entries()) {
      const value = await prisma.user.create({ data: { name: `List12 ${index}`, email: `list12-${tag}-${index}@example.invalid`, password: 'fixture-secret-must-not-leak', role } })
      users.push(value.id); roles[value.id] = role
    }
    const [author, stranger, engineer, admin] = users
    for (let i = 0; i < 40; i++) {
      const createdAt = new Date(+new Date('2034-12-01T00:00:00Z') + Math.floor(i / 2) * 3600000)
      const priority = ['low', 'medium', 'high'][i % 3]
      const dates = deadlines(priority, createdAt)
      const status = ['new', 'in_progress', 'resolved'][i % 3]
      const value = await prisma.ticket.create({ data: {
        title: `List12 ${tag} ${i === 3 ? 'MiXeDNeedle' : 'Item'} ${i}`, description: i === 7 ? 'DescriptionNeedle' : i === 8 ? '100% ready' : i === 9 ? 'a_b' : 'Fixture description',
        userId: i < 33 ? author : stranger, assignedEngineerId: i % 2 ? engineer : null, priority, status, createdAt, updatedAt: new Date(+createdAt + i * 60000), ...dates,
        firstRespondedAt: status === 'new' ? null : new Date(+createdAt + 60000), resolvedAt: status === 'resolved' ? new Date(+dates.resolutionDueAt! + (i % 2 ? 1 : -1)) : null,
      } })
      ids.push(value.id)
    }
    for (const stage of ['response', 'resolution'] as const) for (const status of slaStatuses) {
      const duration = stage === 'response' ? 15 : 240
      const age = status === 'on_time' ? 1 : status === 'approaching_deadline' ? duration - Math.max(duration * .2, 5) : duration
      const createdAt = new Date(+now - age * 60000), dates = deadlines('high', createdAt)
      const completed = status === 'met' ? dates[stage === 'response' ? 'responseDueAt' : 'resolutionDueAt'] : status === 'breached' ? new Date(+dates[stage === 'response' ? 'responseDueAt' : 'resolutionDueAt']! + 1) : null
      const value = await prisma.ticket.create({ data: {
        title: `List12 ${tag} ${stage} ${status}`, description: 'SLA fixture', userId: author, priority: 'high', status: status === 'met' || status === 'breached' || status === 'unknown' ? 'resolved' : 'new', createdAt, ...dates,
        slaTrackedFromCreation: status !== 'unknown', firstRespondedAt: stage === 'response' ? completed : status === 'unknown' ? null : createdAt,
        resolvedAt: stage === 'resolution' ? completed : status === 'met' || status === 'breached' ? now : null,
      } }); ids.push(value.id)
    }
    const all = await prisma.ticket.findMany({ where: { id: { in: ids } } })
    const own = all.filter((item) => item.userId === author)
    const base = `/tickets?search=${tag}`
    async function list(query = '', user = author, scope = '') {
      const response = await get(`${scope}${base}${query}`, user)
      assert.equal(response.status, 200)
      return response.json() as Promise<any>
    }
    await t.test('A/B/C/L: case-insensitive title/description/ID and scoped totals', async () => {
      for (const term of ['mixedneedle', 'descriptionneedle', `#${ids[3]}`, String(ids[3])]) {
        const result = await (await get(`/tickets?search=${encodeURIComponent(term)}`, author)).json() as any
        assert.equal(result.total, 1)
      }
      for (const term of ['%', '_']) assert.equal((await (await get(`/tickets?search=${encodeURIComponent(term)}`, author)).json() as any).total, own.filter((item) => item.title.includes(term) || item.description.includes(term)).length)
      const hidden = await (await get(`/tickets?search=%23${ids[3]}`, stranger)).json() as any
      assert.equal(hidden.total, 0); assert.deepEqual(hidden.items, [])
      const result = await list()
      assert.equal(result.total, own.length); assert.equal(result.summary.total, own.length); assert.equal(result.limit, 10)
      assert.ok(result.items.every((item: any) => item.userId === author))
      assert.ok(!JSON.stringify(result).includes('fixture-secret'))
      assert.ok(result.items.every((item: any) => !('password' in item.user) && !('storageKey' in item)))
      assert.equal((await get('/tickets?ownerId=1', author)).status, 400)
      assert.equal((await get('/tickets?assignedEngineerId=me', author)).status, 400)
    })
    await t.test('D/E/F/G: combined typed filters, UTC calendar dates and assigned engineer', async () => {
      const combined = await list('&status=new&priority=low&limit=50')
      assert.equal(combined.total, own.filter((item) => item.status === 'new' && item.priority === 'low').length)
      const dateFrom = '2034-12-01', dateTo = '2034-12-01'
      const range = await list(`&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=50`)
      const expected = own.filter((item) => item.createdAt >= new Date(`${dateFrom}T00:00Z`) && item.createdAt < new Date('2034-12-02T00:00Z'))
      assert.equal(range.total, expected.length)
      const assigned = await list(`&assignedEngineerId=${engineer}&limit=50`, admin, '/admin')
      assert.equal(assigned.total, all.filter((item) => item.assignedEngineerId === engineer).length)
      const unassigned = await list('&assignedEngineerId=unassigned&limit=50', admin, '/admin')
      assert.equal(unassigned.total, all.filter((item) => item.assignedEngineerId === null).length)
    })
    await t.test('H: every SLA status/stage SQL predicate matches authoritative service before pagination', async () => {
      for (const stage of ['response', 'resolution', 'any']) for (const status of slaStatuses) {
        const result = await list(`&slaStatus=${status}&slaStage=${stage}&pageSize=100`, admin, '/admin')
        const expected = all.filter((item) => { const sla = ticketSla(item, now); return stage === 'any' ? sla.response.status === status || sla.resolution.status === status : sla[stage as 'response' | 'resolution'].status === status })
        assert.equal(result.total, expected.length, `${stage} ${status}`)
        assert.deepEqual(result.items.map((item: any) => item.id).sort((a: number, b: number) => a - b), expected.map((item) => item.id).sort((a, b) => a - b))
      }
    })
    await t.test('I/J/K: stable pagination, semantic priority, date/updated/deadline sorting and empty pages', async () => {
      const collected: number[] = []
      for (let page = 1; page <= Math.ceil(own.length / 10); page++) {
        const result = await list(`&sortBy=createdAt&sortOrder=asc&page=${page}`)
        assert.equal(result.total, own.length); assert.equal(result.totalPages, Math.ceil(own.length / 10)); collected.push(...result.items.map((item: any) => item.id))
      }
      const expected = [...own].sort((a, b) => +a.createdAt - +b.createdAt || a.id - b.id).map((item) => item.id)
      assert.deepEqual(collected, expected); assert.equal(new Set(collected).size, own.length)
      assert.deepEqual((await list('&page=999')).items, [])
      for (const sortBy of ['updatedAt', 'resolutionDueAt']) {
        const result = await list(`&sortBy=${sortBy}&sortOrder=desc&limit=50`)
        const expectedIds = [...own].sort((a: any, b: any) => +b[sortBy] - +a[sortBy] || b.id - a.id).map((item) => item.id)
        assert.deepEqual(result.items.map((item: any) => item.id), expectedIds)
      }
      const priority = await list('&sortBy=priority&sortOrder=desc&limit=50')
      const rank: Record<string, number> = { low: 1, medium: 2, high: 3 }
      assert.deepEqual(priority.items.map((item: any) => item.id), [...own].sort((a, b) => rank[b.priority] - rank[a.priority] || b.id - a.id).map((item) => item.id))
      const urgent = await list('&sortBy=nearestDeadline&sortOrder=asc&limit=50')
      assert.deepEqual(urgent.items.map((item: any) => item.id), [...own].sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || +a.resolutionDueAt! - +b.resolutionDueAt! || a.id - b.id).map((item) => item.id))
    })
    await t.test('M/N/O: current-role enforcement, admin access, strict query validation and injection safety', async () => {
      assert.equal((await list('&limit=50', admin, '/admin')).total, all.length)
      assert.equal((await list('&assignedEngineerId=me&limit=50', engineer, '/engineer')).total, all.filter((item) => item.assignedEngineerId === engineer).length)
      for (const path of ['/tickets', '/engineer/tickets', '/admin/tickets']) assert.equal((await get(path)).status, 401)
      assert.equal((await get('/admin/tickets', author, 'admin')).status, 403)
      assert.equal((await get('/engineer/tickets', author, 'engineer')).status, 403)
      await prisma.user.update({ where: { id: engineer }, data: { role: 'user' } })
      assert.equal((await get('/engineer/tickets?search=' + tag, engineer)).status, 403)
      await prisma.user.update({ where: { id: engineer }, data: { role: 'engineer' } })
      for (const query of ['page=0', 'page=1e2', 'limit=11', 'limit=100', 'status=x', 'priority=x', 'dateFrom=2034-02-30', 'dateFrom=2035-01-02&dateTo=2035-01-01', 'status=new&status=resolved', 'slaStatus=x', 'sortBy=title;DROP TABLE', 'sortOrder=x', 'ownerId=1', 'recipientId=1', 'search=' + 'x'.repeat(101)]) assert.equal((await get(`/admin/tickets?${query}`, admin)).status, 400, query)
      const injection = await (await get('/tickets?search=' + encodeURIComponent("' OR 1=1 --"), author)).json() as any
      assert.equal(injection.total, 0)
      const transact = prisma.$transaction
      const calls: any[] = []
      prisma.$transaction = ((callback: any, options: any) => transact.call(prisma, async (transaction: any) => {
        const findMany = transaction.ticket.findMany
        transaction.ticket.findMany = (args: any) => { calls.push(args); return findMany.call(transaction.ticket, args) }
        return callback(transaction)
      }, options)) as any
      try { await list('&slaStatus=overdue&sortBy=priority&limit=10', admin, '/admin') } finally { prisma.$transaction = transact }
      assert.ok(calls.length > 0 && calls.every((args) => Number.isInteger(args.skip) && args.take <= 10), 'No unbounded findMany during SLA filtering/sorting')
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await prisma.notification.deleteMany({ where: { OR: [{ ticketId: { in: ids } }, { actorId: { in: users } }, { recipientId: { in: users } }] } })
    await prisma.ticket.deleteMany({ where: { id: { in: ids } } }); await prisma.user.deleteMany({ where: { id: { in: users } } })
    mock.restoreAll()
    assert.equal(await snapshot(), before, 'Existing database rows must be preserved')
    console.log(`Step12 cleanup: ${ids.length} fixture tickets and ${users.length} fixture users removed; existing row hashes unchanged.`)
    await prisma.$disconnect()
  }
})
