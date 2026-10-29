import 'dotenv/config'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../src/db/prisma.js'
import { JWT_SECRET } from '../src/config/auth.js'

test('isolated attachment API security and file cleanup (no real database writes)', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'helpdesk-step9-'))
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  const restorers: Array<() => void> = []
  function stub(object: any, method: string, implementation: any) {
    const original = object[method]
    object[method] = implementation
    restorers.push(() => { object[method] = original })
  }
  t.after(() => { for (const restore of restorers.reverse()) restore() })
  process.env.TICKET_UPLOADS_DIR = directory
  const storage = await import('../src/files/storage.js')
  const { default: router } = await import('../src/routes/attachments.js')
  let nextId = 1
  const attachments: any[] = []
  const history: any[] = []
  const roles: Record<number, string> = { 1: 'user', 2: 'user', 3: 'engineer', 4: 'admin' }
  const ticket = { id: 1, userId: 1, assignedEngineerId: null }
  stub(prisma.user, 'findUnique', async ({ where }: any) => roles[where.id] ? { role: roles[where.id] } : null)
  stub(prisma.ticket, 'findFirst', async ({ where }: any) => where.id === 1 && (!where.userId || where.userId === 1) ? ticket : null)
  const transaction = {
    $queryRaw: async () => [{ id: 1 }],
    ticket: { findUnique: async () => ticket },
    user: {
      findUnique: async ({ where }: any) => ({ role: roles[where.id] }),
      findMany: async ({ where }: any) => (where.id?.in ?? []).map((id: number) => ({ id, role: roles[id] })),
    },
    notification: { createMany: async () => ({ count: 0 }) },
    ticketAttachment: {
      count: async () => attachments.length,
      create: async ({ data }: any) => {
        const item = { ...data, id: nextId++, createdAt: new Date().toISOString(), uploadedBy: { id: data.uploadedById, name: 'Test', role: roles[data.uploadedById] } }
        attachments.push(item)
        return item
      },
      findFirst: async ({ where }: any) => attachments.find((a) => a.id === where.id && a.ticketId === where.ticketId) ?? null,
      deleteMany: async ({ where }: any) => {
        const index = attachments.findIndex((a) => a.id === where.id && a.ticketId === where.ticketId)
        if (index < 0) return { count: 0 }
        attachments.splice(index, 1)
        return { count: 1 }
      },
    },
    ticketHistory: { create: async ({ data }: any) => { history.push(data); return data } },
  }
  stub(prisma, '$transaction', async (callback: any) => callback(transaction))
  stub(prisma.ticketAttachment, 'findMany', async () => attachments)
  stub(prisma.ticketAttachment, 'findFirst', transaction.ticketAttachment.findFirst)
  const app = express()
  app.use('/api/tickets', router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}/api/tickets`
  function headers(id?: number, role = roles[id ?? 0]) {
    return id ? { Authorization: `Bearer ${jwt.sign({ userId: id, role }, JWT_SECRET, { algorithm: 'HS256' })}` } : {}
  }
  async function upload(id: number, name: string, content: string | Uint8Array, field = 'file') {
    const form = new FormData()
    form.append(field, new Blob([content as BlobPart]), name)
    return fetch(`${base}/1/attachments`, { method: 'POST', headers: headers(id), body: form })
  }
  async function emptyTemporaryDirectories() {
    // The route sends the response before awaiting filesystem cleanup in finally.
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      if ((await readdir(storage.attachmentTempRoot)).length === 0 && (await readdir(storage.attachmentTrashRoot)).length === 0) break
      await delay(10)
    }
    assert.deepEqual(await readdir(storage.attachmentTempRoot), [])
    assert.deepEqual(await readdir(storage.attachmentTrashRoot), [])
  }
  try {
    await t.test('authentication, IDOR, current database role, malformed IDs', async () => {
      assert.equal((await fetch(`${base}/1/attachments`)).status, 401)
      assert.equal((await fetch(`${base}/1/attachments`, { headers: { Authorization: 'Bearer invalid' } })).status, 401)
      assert.equal((await fetch(`${base}/1/attachments`, { headers: headers(2, 'admin') })).status, 404)
      assert.equal((await upload(2, 'no.txt', 'blocked')).status, 404)
      for (const id of ['0', '-1', 'abc', '9007199254740992', '2']) {
        assert.equal((await fetch(`${base}/${id}/attachments`, { headers: headers(4) })).status, 404)
      }
    })
    await t.test('reject forged content, markup, invalid DOCX, empty and oversized files; clean temporary files', async () => {
      for (const [name, content] of [['fake.pdf', 'plain text'], ['bad.txt', '<html>bad</html>'], ['bad.svg', '<svg/>'], ['bad.docx', 'PK\u0003\u0004invalid'], ['empty.txt', '']] as const) {
        assert.equal((await upload(1, name, content)).status, 415, name)
        await emptyTemporaryDirectories()
      }
      assert.equal((await upload(1, 'wrong.txt', 'text', 'other')).status, 400)
      assert.equal((await upload(1, 'huge.txt', new Uint8Array(10 * 1024 * 1024 + 1).fill(65))).status, 413)
      await emptyTemporaryDirectories()
      assert.equal(attachments.length, 0)
    })
    await t.test('all roles upload/download; own-file deletion; admin deletes any; download headers', async () => {
      for (const id of [1, 3, 4]) {
        const response = await upload(id, `role-${id}.txt`, 'security fixture')
        assert.equal(response.status, 201)
        const added = await response.json() as any
        for (const viewer of [1, 3, 4]) {
          const download = await fetch(`${base}/1/attachments/${added.id}/download`, { headers: headers(viewer) })
          assert.equal(download.status, 200)
          assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
          assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/)
          assert.equal(await download.text(), 'security fixture')
        }
        assert.equal((await fetch(`${base}/1/attachments/${added.id}/download`, { headers: headers(2) })).status, 404)
        const other = id === 1 ? 3 : 1
        assert.equal((await fetch(`${base}/1/attachments/${added.id}`, { method: 'DELETE', headers: headers(other) })).status, 403)
        assert.equal((await fetch(`${base}/1/attachments/${added.id}`, { method: 'DELETE', headers: headers(id) })).status, 204)
        await emptyTemporaryDirectories()
      }
      const added = await (await upload(1, 'admin-delete.txt', 'test')).json() as any
      assert.equal((await fetch(`${base}/1/attachments/${added.id}`, { method: 'DELETE', headers: headers(4) })).status, 204)
      assert.equal(history.filter((h) => h.action === 'attachment_added').length, 4)
      assert.equal(history.filter((h) => h.action === 'attachment_deleted').length, 4)
    })
    await t.test('ten-file limit leaves no orphan or temporary file; missing attachments return 404', async () => {
      for (let i = 0; i < 10; i++) assert.equal((await upload(1, `limit-${i}.txt`, 'fixture')).status, 201)
      assert.equal((await upload(1, 'excess.txt', 'fixture')).status, 413)
      assert.equal(attachments.length, 10)
      assert.equal((await readdir(directory)).filter((name) => !name.startsWith('.')).length, 10)
      await emptyTemporaryDirectories()
      assert.equal((await fetch(`${base}/1/attachments/999/download`, { headers: headers(4) })).status, 404)
      assert.equal((await fetch(`${base}/1/attachments/999`, { method: 'DELETE', headers: headers(4) })).status, 404)
      for (const item of [...attachments]) assert.equal((await fetch(`${base}/1/attachments/${item.id}`, { method: 'DELETE', headers: headers(4) })).status, 204)
      await emptyTemporaryDirectories()
      assert.deepEqual((await readdir(directory)).filter((name) => !name.startsWith('.')), [])
    })
    await t.test('storage traversal and out-of-root temporary deletion rejected; filenames sanitized', async () => {
      for (const key of ['../file.txt', '..\\file.txt', 'C:\\file.txt', 'file.txt']) assert.throws(() => storage.resolveAttachmentPath(key))
      await assert.rejects(storage.removeTemporaryFile(join(directory, 'outside.txt')))
      const fixture = join(storage.attachmentTempRoot, 'name.upload')
      await writeFile(fixture, 'text')
      const inspected = await storage.inspectAttachmentFile(fixture, '../folder/name\u0000.txt')
      assert.equal(inspected.originalName, 'name.txt')
      await storage.removeTemporaryFile(fixture)
      await emptyTemporaryDirectories()
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await prisma.$disconnect()
    // Only the unique directory created by this test is removed.
    await rm(directory, { recursive: true, force: true })
    delete process.env.TICKET_UPLOADS_DIR
  }
})
