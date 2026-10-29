import 'dotenv/config'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test, mock } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { prisma } from '../src/db/prisma.js'
import { JWT_SECRET } from '../src/config/auth.js'
import { deadlines, slaClock } from '../src/sla/service.js'
import { checkSla } from '../src/sla/check.js'
import ticketsRouter from '../src/routes/tickets.js'
import engineerRouter from '../src/routes/engineer.js'
import adminRouter from '../src/routes/admin.js'

test('SLA real PostgreSQL: lifecycle, competing takes/workers, API security, legacy safety and cleanup', async (t) => {
  let now = new Date('2035-01-01T00:00:00Z')
  const start = new Date(now)
  mock.method(slaClock, 'now', () => new Date(now))
  const userIds: number[] = [], ticketIds: number[] = []
  const snapshot = async () => createHash('sha256').update(JSON.stringify(await Promise.all([
    prisma.user.findMany({ orderBy: { id: 'asc' } }), prisma.ticket.findMany({ orderBy: { id: 'asc' } }), prisma.ticketComment.findMany({ orderBy: { id: 'asc' } }), prisma.ticketHistory.findMany({ orderBy: { id: 'asc' } }), prisma.ticketAttachment.findMany({ orderBy: { id: 'asc' } }), prisma.notification.findMany({ orderBy: { id: 'asc' } }), prisma.ticketSlaEvent.findMany({ orderBy: { id: 'asc' } }),
  ]))).digest('hex')
  const before = await snapshot()
  const app = express()
  app.use(express.json())
  app.use('/api/tickets', ticketsRouter)
  app.use('/api/engineer/tickets', engineerRouter)
  app.use('/api/admin', adminRouter)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const roles: Record<number, string> = {}
  async function request(path: string, id?: number, method = 'GET', body?: unknown) {
    return fetch(`${origin}/api${path}`, { method, headers: { ...(id ? { Authorization: `Bearer ${jwt.sign({ userId: id, role: roles[id] }, JWT_SECRET, { algorithm: 'HS256' })}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  }
  try {
    const tag = randomUUID()
    for (const [index, role] of ['user', 'user', 'engineer', 'engineer', 'admin'].entries()) {
      const user = await prisma.user.create({ data: { name: `SLA fixture ${index}`, email: `sla-${tag}-${index}@example.invalid`, password: 'not-a-login-hash', role } })
      userIds.push(user.id); roles[user.id] = role
    }
    const [author, stranger, engineer, rival, admin] = userIds
    async function create(priority = 'high') {
      const response = await request('/tickets', author, 'POST', { title: `SLA ${tag}`, description: 'temporary fixture', priority })
      assert.equal(response.status, 201)
      const value = await response.json() as any
      ticketIds.push(value.id)
      return value
    }
    await t.test('A/B/H/I: persisted deadlines, server-only fields, JWT and owner isolation', async () => {
      for (const priority of ['high', 'medium', 'low']) {
        const value = await create(priority)
        const expected = deadlines(priority, now)
        assert.equal(value.responseDueAt, expected.responseDueAt!.toISOString())
        assert.equal(value.resolutionDueAt, expected.resolutionDueAt!.toISOString())
        assert.equal(value.sla.serverNow, now.toISOString())
        assert.equal((await request(`/tickets/${value.id}`, stranger)).status, 404)
        const fresh = new PrismaClient()
        try { assert.deepEqual((await fresh.ticket.findUniqueOrThrow({ where: { id: value.id } })).responseDueAt, expected.responseDueAt) } finally { await fresh.$disconnect() }
      }
      assert.equal((await request('/tickets', author, 'POST', { title: 'Injected', description: 'test', priority: 'high', responseDueAt: '2040-01-01' })).status, 400)
      assert.equal((await request('/admin/sla/stats')).status, 401)
      for (const id of [author, stranger, engineer]) assert.equal((await request('/admin/sla/stats', id)).status, 403)
      assert.equal((await request('/engineer/tickets?slaStatus=overdue', author)).status, 403)
    })
    await t.test('C/G: assignment is not reaction; assigned engineer can take; reassign/unassign never resets SLA', async () => {
      const value = await create()
      assert.equal((await request(`/admin/tickets/${value.id}/assign`, admin, 'PATCH', { engineerId: engineer })).status, 200)
      assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: value.id } })).firstRespondedAt, null)
      now = new Date(+start + 5 * 60_000)
      assert.equal((await request(`/engineer/tickets/${value.id}/take`, engineer, 'PATCH')).status, 200)
      const first = await prisma.ticket.findUniqueOrThrow({ where: { id: value.id } })
      assert.deepEqual(first.firstRespondedAt, now)
      assert.equal((await request(`/admin/tickets/${value.id}/assign`, admin, 'PATCH', { engineerId: null })).status, 200)
      assert.equal((await request(`/admin/tickets/${value.id}/assign`, admin, 'PATCH', { engineerId: rival })).status, 200)
      now = new Date(+start + 7 * 60_000)
      assert.equal((await request(`/engineer/tickets/${value.id}/take`, rival, 'PATCH')).status, 200)
      const second = await prisma.ticket.findUniqueOrThrow({ where: { id: value.id } })
      assert.deepEqual(second.firstRespondedAt, first.firstRespondedAt)
      assert.deepEqual(second.responseDueAt, first.responseDueAt)
      assert.deepEqual(second.resolutionDueAt, first.resolutionDueAt)
    })
    await t.test('D/E: real concurrent take has one reaction; first resolution remains immutable', async () => {
      const value = await create()
      now = new Date(+now + 60_000)
      const attempts = await Promise.all([request(`/engineer/tickets/${value.id}/take`, engineer, 'PATCH'), request(`/engineer/tickets/${value.id}/take`, rival, 'PATCH')])
      assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409])
      const taken = await prisma.ticket.findUniqueOrThrow({ where: { id: value.id } })
      assert.deepEqual(taken.firstRespondedAt, now)
      assert.equal(await prisma.notification.count({ where: { ticketId: value.id, type: 'ticket_taken' } }), 1)
      assert.equal(await prisma.ticketHistory.count({ where: { ticketId: value.id, action: 'engineer_assigned' } }), 1)
      now = new Date(+now + 60_000)
      assert.equal((await request(`/engineer/tickets/${value.id}/resolve`, taken.assignedEngineerId!, 'PATCH')).status, 200)
      const resolvedAt = (await prisma.ticket.findUniqueOrThrow({ where: { id: value.id } })).resolvedAt
      assert.deepEqual(resolvedAt, now)
      now = new Date(+now + 60_000)
      assert.equal((await request(`/engineer/tickets/${value.id}/resolve`, taken.assignedEngineerId!, 'PATCH')).status, 200)
      assert.deepEqual((await prisma.ticket.findUniqueOrThrow({ where: { id: value.id } })).resolvedAt, resolvedAt)
    })
    await t.test('F/K/L/M: controlled clock, concurrent workers, unique events, no warnings after completion or for legacy', async () => {
      now = new Date(start)
      const value = await create()
      const ids = [value.id]
      const check = () => checkSla({ now, ticketIds: ids })
      now = new Date(+start + 10 * 60_000 - 1)
      assert.equal((await check()).events, 0)
      now = new Date(+start + 10 * 60_000)
      assert.equal((await Promise.all([check(), check()])).reduce((sum, result) => sum + result.events, 0), 1)
      const events = await prisma.ticketSlaEvent.findMany({ where: { ticketId: value.id } })
      assert.equal(events.length, 1)
      const notices = await prisma.notification.findMany({ where: { ticketId: value.id, type: 'sla_response_approaching_deadline' } })
      assert.ok(notices.some((item) => item.recipientId === author))
      assert.ok(notices.some((item) => item.recipientId === admin))
      assert.ok(notices.every((item) => item.recipientId !== stranger && item.recipientId !== engineer && item.recipientId !== rival))
      assert.equal(new Set(notices.map((item) => item.recipientId)).size, notices.length)
      assert.equal((await check()).events, 0)
      assert.equal((await request(`/engineer/tickets/${value.id}/take`, engineer, 'PATCH')).status, 200)
      now = new Date(+start + 192 * 60_000)
      assert.equal((await Promise.all([check(), check()])).reduce((sum, result) => sum + result.events, 0), 1)
      now = new Date(+start + 240 * 60_000)
      assert.equal((await check()).events, 1)
      assert.equal((await check()).events, 0)
      assert.equal(await prisma.ticketSlaEvent.count({ where: { ticketId: value.id, stage: 'response', phase: 'overdue' } }), 0)
      assert.equal((await request(`/engineer/tickets/${value.id}/resolve`, engineer, 'PATCH')).status, 200)
      now = new Date(+start + 48 * 60 * 60_000)
      assert.equal((await check()).events, 0)
      const legacy = await prisma.ticket.create({ data: { title: 'Legacy SLA fixture', description: 'test', userId: author, priority: 'high', createdAt: start, ...deadlines('high', start), slaTrackedFromCreation: false, status: 'resolved' } })
      ticketIds.push(legacy.id)
      const legacyResponse = await (await request(`/tickets/${legacy.id}`, author)).json() as any
      assert.equal(legacyResponse.sla.response.status, 'unknown')
      assert.equal(legacyResponse.sla.resolution.status, 'unknown')
      assert.equal((await checkSla({ now, ticketIds: [legacy.id] })).events, 0)
      await prisma.ticket.update({ where: { id: legacy.id }, data: { status: 'new' } })
      assert.equal((await checkSla({ now, ticketIds: [legacy.id] })).events, 0)
    })
    await t.test('J: API stats, sorting and independent filters match known resolution outcomes; query validation', async () => {
      const good = await prisma.ticket.count({ where: { status: 'resolved', resolvedAt: { lte: prisma.ticket.fields.resolutionDueAt } } })
      const bad = await prisma.ticket.count({ where: { status: 'resolved', resolvedAt: { gt: prisma.ticket.fields.resolutionDueAt } } })
      const stats = await (await request('/admin/sla/stats', admin)).json() as any
      assert.equal(stats.resolvedOnTime, good)
      assert.equal(stats.resolvedBreached, bad)
      assert.equal(stats.compliancePercent, good + bad ? Math.round(good / (good + bad) * 1000) / 10 : null)
      assert.equal(stats.activeTickets, await prisma.ticket.count({ where: { status: { not: 'resolved' } } }))
      const filtered = await (await request('/admin/tickets?slaStatus=overdue&slaStage=response&pageSize=100', admin)).json() as any
      assert.ok(filtered.items.length > 0)
      assert.ok(filtered.items.every((item: any) => item.sla.response.status === 'overdue'))
      assert.equal(filtered.total, (await prisma.ticket.findMany({ where: { slaTrackedFromCreation: true, status: { not: 'resolved' }, firstRespondedAt: null, responseDueAt: { lte: now } } })).length)
      const ordered = (await (await request('/engineer/tickets?sort=resolutionDueAt&slaStatus=overdue&slaStage=resolution', engineer)).json() as any).items as any[]
      assert.ok(ordered.every((item) => item.sla.resolution.status === 'overdue'))
      assert.deepEqual(ordered.map((item) => item.resolutionDueAt), ordered.map((item) => item.resolutionDueAt).sort())
      for (const query of ['?slaStatus=bad', '?slaStage=bad', '?slaStatus=overdue&slaStatus=met']) assert.equal((await request(`/admin/tickets${query}`, admin)).status, 400)
      assert.equal((await request('/engineer/tickets?sort=bad', engineer)).status, 400)
      assert.equal((await request('/admin/sla/stats?recipientId=1', admin)).status, 400)
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await prisma.notification.deleteMany({ where: { OR: [{ ticketId: { in: ticketIds } }, { actorId: { in: userIds } }, { recipientId: { in: userIds } }] } })
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    mock.restoreAll()
    assert.equal(await snapshot(), before, 'Original rows including SLA events must remain unchanged')
    console.log(`SLA cleanup verified: ${userIds.length} fixture users, ${ticketIds.length} fixture tickets, original row hashes identical.`)
    await prisma.$disconnect()
  }
})
