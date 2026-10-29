import 'dotenv/config'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { prisma } from '../src/db/prisma.js'
import { JWT_SECRET } from '../src/config/auth.js'

test('Step 10: real PostgreSQL notification lifecycle, security, concurrency and cleanup', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'helpdesk-step10-'))
  process.env.TICKET_UPLOADS_DIR = directory
  const userIds: number[] = []
  const ticketIds: number[] = []
  let server: ReturnType<typeof express.prototype.listen> | undefined
  const snapshot = async () => {
    const tables = await Promise.all([prisma.user.findMany({ orderBy: { id: 'asc' } }), prisma.ticket.findMany({ orderBy: { id: 'asc' } }), prisma.ticketComment.findMany({ orderBy: { id: 'asc' } }), prisma.ticketHistory.findMany({ orderBy: { id: 'asc' } }), prisma.ticketAttachment.findMany({ orderBy: { id: 'asc' } }), prisma.notification.findMany({ orderBy: { id: 'asc' } })])
    return createHash('sha256').update(JSON.stringify(tables)).digest('hex')
  }
  const before = await snapshot()
  try {
    const tag = randomUUID()
    for (const [index, role] of ['user', 'user', 'engineer', 'engineer', 'admin'].entries()) {
      const user = await prisma.user.create({ data: { name: `Step10 fixture ${index}`, email: `step10-${tag}-${index}@example.invalid`, password: 'test-only-not-a-login-hash', role } })
      userIds.push(user.id)
    }
    const [author, stranger, engineer, rival, admin] = userIds
    const [ticketsRouter, engineerRouter, adminRouter, attachmentsRouter, notificationsRouter] = await Promise.all([
      import('../src/routes/tickets.js'), import('../src/routes/engineer.js'), import('../src/routes/admin.js'), import('../src/routes/attachments.js'), import('../src/routes/notifications.js'),
    ])
    const app = express()
    app.use(express.json())
    app.use('/api/tickets', attachmentsRouter.default, ticketsRouter.default)
    app.use('/api/engineer/tickets', engineerRouter.default)
    app.use('/api/admin', adminRouter.default)
    app.use('/api/notifications', notificationsRouter.default)
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server!.once('listening', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const roles: Record<number, string> = { [author]: 'user', [stranger]: 'user', [engineer]: 'engineer', [rival]: 'engineer', [admin]: 'admin' }
    function token(id: number, role = roles[id]) { return jwt.sign({ userId: id, role }, JWT_SECRET, { algorithm: 'HS256' }) }
    async function request(path: string, id?: number, method = 'GET', body?: unknown) {
      return fetch(`${origin}/api${path}`, { method, headers: { ...(id ? { Authorization: `Bearer ${token(id)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    }
    async function createTicket() {
      const response = await request('/tickets', author, 'POST', { title: `Step10 ${tag}`, description: 'secret-token-must-never-be-in-notifications', priority: 'medium' })
      assert.equal(response.status, 201)
      const ticket = await response.json() as { id: number }
      ticketIds.push(ticket.id)
      return ticket.id
    }
    async function events(ticketId: number, type?: string) { return prisma.notification.findMany({ where: { ticketId, ...(type ? { type } : {}) } }) }
    const ticketId = await createTicket()
    await t.test('A/G: creation notifies accessible engineers, excludes author and unrelated user', async () => {
      const rows = await events(ticketId, 'ticket_created')
      assert.ok(rows.some((row) => row.recipientId === engineer))
      assert.ok(rows.some((row) => row.recipientId === rival))
      assert.ok(rows.every((row) => row.recipientId !== author && row.recipientId !== stranger && row.recipientId !== row.actorId))
      assert.ok(rows.every((row) => !row.message.includes('secret-token') && !row.message.includes(tag)))
    })
    await t.test('B/E/F: assignment, no-op assignment, comments and attachments notify the other side', async () => {
      assert.equal((await request(`/admin/tickets/${ticketId}/assign`, admin, 'PATCH', { engineerId: engineer })).status, 200)
      const assigned = await events(ticketId, 'ticket_assigned')
      assert.deepEqual(assigned.map((row) => row.recipientId).sort(), [author, engineer].sort())
      assert.equal((await request(`/admin/tickets/${ticketId}/assign`, admin, 'PATCH', { engineerId: engineer })).status, 200)
      assert.equal((await events(ticketId, 'ticket_assigned')).length, 2)
      const beforeFailure = (await events(ticketId)).length
      assert.equal((await request(`/admin/tickets/${ticketId}/assign`, admin, 'PATCH', { engineerId: stranger })).status, 400)
      assert.equal((await request(`/engineer/tickets/${ticketId}/resolve`, rival, 'PATCH')).status, 403)
      assert.equal((await request(`/tickets/${ticketId}/comments`, author, 'POST', { message: '' })).status, 400)
      assert.equal((await events(ticketId)).length, beforeFailure)
      for (const writer of [author, engineer, admin]) assert.equal((await request(`/tickets/${ticketId}/comments`, writer, 'POST', { message: 'private token /private/path' })).status, 201)
      const comments = await events(ticketId, 'new_comment')
      assert.deepEqual(comments.map((row) => row.recipientId).sort(), [engineer, author, author].sort())
      for (const writer of [author, engineer]) {
        const form = new FormData()
        form.append('file', new Blob(['temporary fixture']), 'private-path-token.txt')
        assert.equal((await fetch(`${origin}/api/tickets/${ticketId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${token(writer)}` }, body: form })).status, 201)
      }
      assert.deepEqual((await events(ticketId, 'attachment_added')).map((row) => row.recipientId).sort(), [author, engineer].sort())
      assert.ok((await events(ticketId)).every((row) => row.recipientId !== row.actorId && !row.message.includes('private') && !row.message.includes('token')))
    })
    await t.test('C/D/H: concurrent take produces one winner and notification, resolution is idempotent', async () => {
      const concurrentTicket = await createTicket()
      const attempts = await Promise.all([request(`/engineer/tickets/${concurrentTicket}/take`, engineer, 'PATCH'), request(`/engineer/tickets/${concurrentTicket}/take`, rival, 'PATCH')])
      assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409])
      const taken = await events(concurrentTicket, 'ticket_taken')
      assert.equal(taken.length, 1)
      assert.equal(taken[0].recipientId, author)
      const current = await prisma.ticket.findUniqueOrThrow({ where: { id: concurrentTicket } })
      assert.equal((await request(`/engineer/tickets/${concurrentTicket}/take`, current.assignedEngineerId!, 'PATCH')).status, 409)
      for (let i = 0; i < 2; i++) assert.equal((await request(`/engineer/tickets/${concurrentTicket}/resolve`, current.assignedEngineerId!, 'PATCH')).status, 200)
      assert.equal((await events(concurrentTicket, 'ticket_resolved')).length, 1)
      assert.equal((await events(concurrentTicket, 'ticket_taken')).length, 1)
      assert.equal(await prisma.ticketHistory.count({ where: { ticketId: concurrentTicket, action: 'engineer_assigned' } }), 1)
    })
    await t.test('unassignment, unassigned comments and self-actions do not notify arbitrary engineers', async () => {
      assert.equal((await request(`/admin/tickets/${ticketId}/assign`, admin, 'PATCH', { engineerId: null })).status, 200)
      assert.deepEqual((await events(ticketId, 'ticket_unassigned')).map((row) => row.recipientId).sort(), [author, engineer].sort())
      const count = (await events(ticketId)).length
      assert.equal((await request(`/tickets/${ticketId}/comments`, author, 'POST', { message: 'No engineer assigned' })).status, 201)
      assert.equal((await events(ticketId)).length, count)
      assert.equal((await request(`/tickets/${ticketId}/comments`, stranger, 'POST', { message: 'forbidden' })).status, 404)
      assert.equal((await events(ticketId)).length, count)
      const own = await prisma.ticket.create({ data: { title: 'Own fixture', description: 'test', priority: 'low', userId: engineer, assignedEngineerId: engineer } })
      ticketIds.push(own.id)
      assert.equal((await request(`/tickets/${own.id}/comments`, engineer, 'POST', { message: 'self' })).status, 201)
      assert.equal((await events(own.id)).length, 0)
    })
    await t.test('I/J/K: JWT, validation, recipient tampering, own-only lists/read/read-all, counters and stable readAt', async () => {
      for (const [path, method] of [['/notifications', 'GET'], ['/notifications/unread-count', 'GET'], ['/notifications/read-all', 'PATCH'], ['/notifications/1/read', 'PATCH']]) assert.equal((await request(path, undefined, method)).status, 401)
      for (const query of ['?recipientId=1', '?page=0', '?limit=101', '?page=1&page=2', '?unreadOnly=yes', '?page=1e2', '?limit=-1']) assert.equal((await request(`/notifications${query}`, author)).status, 400)
      for (const value of ['abc', '0', '-1', '2147483648']) assert.equal((await request(`/notifications/${value}/read`, author, 'PATCH')).status, 400)
      const listResponse = await request('/notifications?limit=100', author)
      assert.equal(listResponse.status, 200)
      const list = await listResponse.json() as any
      const ownIds = new Set((await prisma.notification.findMany({ where: { recipientId: author } })).map((row) => row.id))
      assert.equal(list.total, ownIds.size)
      const ordered = await prisma.notification.findMany({ where: { recipientId: author }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
      assert.deepEqual(list.items.map((row: any) => row.id), ordered.map((row) => row.id))
      const pageTwo = await (await request('/notifications?page=2&limit=1', author)).json() as any
      assert.equal(pageTwo.items.length, 1)
      assert.equal(pageTwo.items[0].id, ordered[1].id)
      assert.ok(list.items.every((row: any) => ownIds.has(row.id)))
      assert.ok(list.items.every((row: any) => !('recipientId' in row) && !('actorId' in row) && !('ticket' in row)))
      const other = (await prisma.notification.findFirstOrThrow({ where: { recipientId: engineer } })).id
      assert.equal((await request(`/notifications/${other}/read`, author, 'PATCH', { recipientId: engineer })).status, 404)
      assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: other } })).isRead, false)
      const first = list.items[0].id
      assert.equal((await request(`/notifications/${first}/read`, author, 'PATCH')).status, 200)
      const readAt = (await prisma.notification.findUniqueOrThrow({ where: { id: first } })).readAt
      assert.equal((await request(`/notifications/${first}/read`, author, 'PATCH')).status, 200)
      assert.deepEqual((await prisma.notification.findUniqueOrThrow({ where: { id: first } })).readAt, readAt)
      const unread = await (await request('/notifications/unread-count', author)).json() as any
      assert.equal(unread.count, ownIds.size - 1)
      assert.equal((await request('/notifications/read-all', author, 'PATCH', { recipientId: engineer })).status, 200)
      assert.equal((await (await request('/notifications/unread-count', author)).json() as any).count, 0)
      assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: other } })).isRead, false)
      assert.deepEqual((await (await request('/notifications?unreadOnly=true', author)).json() as any).items, [])
      const empty = await (await request('/notifications', stranger)).json() as any
      assert.deepEqual(empty.items, [])
    })
    await t.test('role revocation redacts old ticket details using current role, not stale JWT; reload persists', async () => {
      await prisma.user.update({ where: { id: engineer }, data: { role: 'user' } })
      const rows = (await (await request('/notifications?limit=100', engineer)).json() as any).items
      const restricted = rows.filter((row: any) => row.ticketId === null)
      assert.ok(restricted.length > 0)
      assert.ok(restricted.every((row: any) => row.type === null && row.title === 'Заявка недоступна' && !row.message.includes(`#${ticketId}`)))
      const fresh = new PrismaClient()
      try { assert.ok(await fresh.notification.count({ where: { recipientId: engineer } }) > 0) } finally { await fresh.$disconnect() }
      await prisma.user.update({ where: { id: engineer }, data: { role: 'engineer' } })
    })
    await t.test('deleted tickets retain notifications with ticketId null; actor/recipient deletion rules', async () => {
      const removed = await createTicket()
      const ids = (await events(removed)).map((row) => row.id)
      assert.equal((await request(`/tickets/${removed}`, author, 'DELETE')).status, 204)
      assert.equal(await prisma.notification.count({ where: { id: { in: ids }, ticketId: null } }), ids.length)
      const actor = await prisma.user.create({ data: { name: 'Deleted actor fixture', email: `actor-${tag}@example.invalid`, password: 'test-only', role: 'user' } })
      userIds.push(actor.id)
      const notification = await prisma.notification.create({ data: { actorId: actor.id, recipientId: stranger, type: 'new_comment', title: 'Fixture', message: 'Fixture' } })
      await prisma.user.delete({ where: { id: actor.id } })
      assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).actorId, null)
      const recipient = await prisma.user.create({ data: { name: 'Deleted recipient fixture', email: `recipient-${tag}@example.invalid`, password: 'test-only', role: 'user' } })
      userIds.push(recipient.id)
      const cascaded = await prisma.notification.create({ data: { recipientId: recipient.id, type: 'new_comment', title: 'Fixture', message: 'Fixture' } })
      await prisma.user.delete({ where: { id: recipient.id } })
      assert.equal(await prisma.notification.findUnique({ where: { id: cascaded.id } }), null)
    })
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
    // Remove only records owned or initiated by this run's exact fixture IDs.
    await prisma.notification.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { recipientId: { in: userIds } }] } })
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    assert.equal(await snapshot(), before, 'Existing database rows must remain byte-for-byte equivalent')
    await delay(50)
    console.log(`Cleanup verified: ${userIds.length} fixture users, ${ticketIds.length} fixture tickets; original rows unchanged; isolated files: ${(await readdir(directory)).length} entries removed.`)
    await rm(directory, { recursive: true, force: true })
    await prisma.$disconnect()
    delete process.env.TICKET_UPLOADS_DIR
  }
})
