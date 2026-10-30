import 'dotenv/config'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test, mock } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../src/db/prisma.js'
import { JWT_SECRET } from '../src/config/auth.js'
import { deadlines, slaClock } from '../src/sla/service.js'
import adminRouter from '../src/routes/admin.js'

test('Step13 real PostgreSQL analytics, attribution, CSV and safe cleanup', async (t) => {
  const now = new Date('2035-02-01T00:00:00Z')
  mock.method(slaClock, 'now', () => now)
  const users: number[] = [], tickets: number[] = []
  const snapshot = async () => createHash('sha256').update(JSON.stringify(await Promise.all([
    prisma.user.findMany({ orderBy: { id: 'asc' } }), prisma.ticket.findMany({ orderBy: { id: 'asc' } }), prisma.ticketComment.findMany({ orderBy: { id: 'asc' } }), prisma.ticketHistory.findMany({ orderBy: { id: 'asc' } }), prisma.ticketAttachment.findMany({ orderBy: { id: 'asc' } }), prisma.notification.findMany({ orderBy: { id: 'asc' } }), prisma.ticketSlaEvent.findMany({ orderBy: { id: 'asc' } }),
  ]))).digest('hex')
  const before = await snapshot()
  const app = express(); app.use(express.json()); app.use('/api/admin', adminRouter)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/admin/analytics`
  const roles: Record<number, string> = {}
  const period = 'dateFrom=2035-01-01&dateTo=2035-01-03'
  async function get(kind: string, id?: number, query = period, role = roles[id ?? 0]) {
    return fetch(`${origin}/${kind}?${query}`, { headers: id ? { Authorization: `Bearer ${jwt.sign({ userId: id, role }, JWT_SECRET, { algorithm: 'HS256' })}` } : {} })
  }
  try {
    const tag = randomUUID(), dangerousName = '=SUM(1,2) "Инженер"\r\nСтрока'
    for (const [index, role] of ['user', 'engineer', 'engineer', 'admin'].entries()) {
      const user = await prisma.user.create({ data: { name: index === 1 ? dangerousName : `Analytics ${index}`, email: `analytics-${tag}-${index}@example.invalid`, password: 'analytics-fixture-secret', role } })
      users.push(user.id); roles[user.id] = role
    }
    const [author, engineerA, engineerB, admin] = users
    async function create(created: string, first: string | null, resolved: string | null, assigned: number | null, options: { priority?: string; legacy?: boolean; status?: string; dueUnknown?: boolean; actors?: number[] } = {}) {
      const createdAt = new Date(created), priority = options.priority ?? 'high'
      const ticket = await prisma.ticket.create({ data: { title: `Analytics ${tag}`, description: 'private token /private/path must never be exported', userId: author, assignedEngineerId: assigned, priority, createdAt, ...deadlines(priority, createdAt), firstRespondedAt: first ? new Date(first) : null, resolvedAt: resolved ? new Date(resolved) : null, status: options.status ?? (resolved ? 'resolved' : 'in_progress'), slaTrackedFromCreation: !options.legacy, ...(options.dueUnknown ? { resolutionDueAt: null } : {}) } })
      tickets.push(ticket.id)
      if (resolved) for (const actorId of options.actors ?? []) await prisma.ticketHistory.create({ data: { ticketId: ticket.id, actorId, action: 'status_changed', oldValue: 'in_progress', newValue: 'resolved', createdAt: new Date(+new Date(resolved) + 2) } })
      return ticket
    }
    await create('2035-01-01T00:00Z', '2035-01-01T00:10Z', '2035-01-01T02:00Z', engineerB, { actors: [engineerA] })
    await create('2034-12-31T23:00Z', '2034-12-31T23:30Z', '2035-01-02T01:00Z', engineerB, { priority: 'low', actors: [engineerA] })
    await create('2035-01-02T05:00+05:00', '2035-01-02T00:20Z', null, engineerA)
    await create('2035-01-03T23:59:59.999Z', null, null, engineerA, { legacy: true, status: 'resolved' })
    await create('2035-01-04T00:00Z', null, null, engineerB, { status: 'new' })
    await create('2035-01-02T03:00Z', '2035-01-02T02:00Z', '2035-01-02T02:00Z', engineerA)
    await create('2035-01-03T00:00Z', '2035-01-03T00:30Z', '2035-01-03T01:00Z', engineerA, { dueUnknown: true })
    await create('2035-01-01T03:00Z', '2035-01-01T03:40Z', '2035-01-01T04:00Z', engineerA, { legacy: true, actors: [admin] })
    await create('2035-01-02T05:00Z', null, '2035-01-02T06:00Z', engineerA, { actors: [engineerA, engineerB] })
    await t.test('A/D/E/F/G: creation/event cohorts, valid averages, SLA fractions and unavailable historical state', async () => {
      const response = await get('overview', admin); assert.equal(response.status, 200)
      const value = await response.json() as any
      assert.equal(value.created, 7); assert.equal(value.resolved, 5)
      assert.equal(value.activeAtPeriodEnd, null); assert.ok(value.activeAtPeriodEndReason)
      assert.equal(value.averageResponse.milliseconds, 20 * 60000); assert.equal(value.averageResponse.samples, 3); assert.equal(value.averageResponse.excluded, 4)
      assert.equal(value.averageResolution.milliseconds, 31 * 3600000 / 5); assert.equal(value.averageResolution.samples, 5)
      assert.deepEqual(value.resolutionSla, { numerator: 3, denominator: 4, percent: 75, unknown: 1 })
      assert.equal(value.excludedResolutionEvents, 1)
      assert.equal(value.statuses.resolved, 6); assert.equal(value.statuses.in_progress, 1)
      assert.equal(value.priorities.high, 7)
      const sla = await (await get('sla', admin)).json() as any
      assert.deepEqual(sla.response, { numerator: 1, denominator: 3, percent: 33.3, unknown: 4 })
      assert.deepEqual(sla.resolution, value.resolutionSla)
    })
    await t.test('B/C/G: UTC grouping, zero days, ISO weeks/months and start/end boundaries', async () => {
      const main = await (await get('tickets-trend', admin)).json() as any
      assert.deepEqual(main.buckets.map((row: any) => [row.created, row.resolved]), [[2, 2], [3, 2], [2, 1]])
      assert.equal(main.buckets[0].bucket, '2035-01-01T00:00:00.000Z')
      const padded = await (await get('tickets-trend', admin, 'dateFrom=2035-01-01&dateTo=2035-01-06')).json() as any
      assert.deepEqual(padded.buckets.map((row: any) => row.created), [2, 3, 2, 1, 0, 0])
      for (const interval of ['week', 'month']) {
        const report = await (await get('tickets-trend', admin, `dateFrom=2034-12-31&dateTo=2035-01-07&interval=${interval}`)).json() as any
        assert.ok(report.buckets.every((row: any) => interval === 'week' ? new Date(row.bucket).getUTCDay() === 1 : new Date(row.bucket).getUTCDate() === 1))
        assert.equal(report.buckets.reduce((sum: number, row: any) => sum + row.created, 0), 9)
      }
    })
    await t.test('I: resolution actor, not current assignee; unknown and conflicting history remain unattributed', async () => {
      const value = await (await get('engineers', admin)).json() as any
      const a = value.items.find((item: any) => item.id === engineerA), b = value.items.find((item: any) => item.id === engineerB)
      assert.equal(a.resolved, 2); assert.equal(a.averageResolutionMs, 14 * 3600000); assert.equal(a.activeAssigned, 1)
      assert.deepEqual(a.resolutionSla, { numerator: 1, denominator: 2, percent: 50, unknown: 0 })
      assert.equal(b.resolved, 0); assert.equal(b.averageResolutionMs, null); assert.equal(b.activeAssigned, 1)
      assert.equal(value.attribution.unknownActor, 2); assert.equal(value.attribution.otherActor, 1)
      const filtered = await (await get('overview', admin, `${period}&engineerId=${engineerA}`)).json() as any
      assert.equal(filtered.created, 6); assert.equal(filtered.resolved, 2); assert.equal(filtered.averageResolution.milliseconds, 14 * 3600000)
      const reassigned = await (await get('overview', admin, `${period}&engineerId=${engineerB}`)).json() as any
      assert.equal(reassigned.created, 1); assert.equal(reassigned.resolved, 0)
    })
    await t.test('H/J: admin-only JWT, current database role, strict params, injection and sanitized failures', async () => {
      for (const kind of ['overview', 'tickets-trend', 'engineers', 'sla', 'export']) {
        assert.equal((await get(kind)).status, 401)
        assert.equal((await get(kind, author)).status, 403)
        assert.equal((await get(kind, engineerA)).status, 403)
        assert.equal((await get(kind, author, period, 'admin')).status, 403)
        assert.equal((await get(kind, admin)).status, 200)
      }
      for (const query of ['dateFrom=2035-02-30', 'dateFrom=2035-01-04&dateTo=2035-01-01', 'dateFrom=2034-01-01&dateTo=2035-01-04', 'interval=year', 'interval=day&interval=month', 'engineerId=0', `engineerId=${author}`, 'engineerId=2147483648', 'ownerId=1', 'interval=day;DROP TABLE', 'dateFrom=x']) assert.equal((await get('overview', admin, query)).status, 400, query)
      const original = prisma.$transaction
      prisma.$transaction = (() => { throw new Error('secret-SQL-token-database-config') }) as any
      try {
        for (const kind of ['overview', 'export']) { const response = await get(kind, admin); assert.equal(response.status, 500); assert.ok(!(await response.text()).includes('secret')) }
      } finally { prisma.$transaction = original }
    })
    await t.test('K/L: CSV headers, UTF-8 BOM, Cyrillic, formula defense, quoting and no secrets/raw tickets', async () => {
      const response = await get('export', admin)
      assert.match(response.headers.get('content-type') ?? '', /^text\/csv; charset=utf-8/)
      assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="helpdesk-analytics-2035-01-01-2035-01-03.csv"$/)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      const bytes = new Uint8Array(await response.arrayBuffer())
      assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf])
      const csv = new TextDecoder().decode(bytes)
      assert.ok(csv.includes('Создано за период'))
      assert.ok(csv.includes('"\'=SUM(1,2) ""Инженер""\r\nСтрока"'))
      assert.ok(!csv.includes('analytics-fixture-secret') && !csv.includes('/private/path') && !csv.includes(tag) && !csv.includes('@example.invalid'))
      const filtered = await (await get('export', admin, `${period}&engineerId=${engineerA}`)).text()
      assert.ok(filtered.includes('"Решено за период","2"'))
    })
    await t.test('observed now is inclusive, future events are excluded, and empty periods stay genuinely empty', async () => {
      await create(now.toISOString(), now.toISOString(), now.toISOString(), null)
      await create('2035-02-02T00:00Z', null, null, null)
      const current = await (await get('overview', admin, 'dateFrom=2035-02-01&dateTo=2035-02-02')).json() as any
      assert.equal(current.created, 1); assert.equal(current.resolved, 1); assert.equal(current.averageResponse.milliseconds, 0)
      const empty = await (await get('overview', admin, 'dateFrom=2033-01-01&dateTo=2033-01-02')).json() as any
      assert.equal(empty.created, 0); assert.equal(empty.resolved, 0); assert.equal(empty.averageResolution.milliseconds, null); assert.equal(empty.resolutionSla.percent, null)
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await prisma.notification.deleteMany({ where: { OR: [{ ticketId: { in: tickets } }, { actorId: { in: users } }, { recipientId: { in: users } }] } })
    await prisma.ticket.deleteMany({ where: { id: { in: tickets } } }); await prisma.user.deleteMany({ where: { id: { in: users } } })
    mock.restoreAll()
    assert.equal(await snapshot(), before, 'Original database rows must remain unchanged')
    console.log(`Analytics cleanup: ${tickets.length} fixture tickets and ${users.length} fixture users removed; original row hashes match.`)
    await prisma.$disconnect()
  }
})
