import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canDeleteAttachment, checkAttachmentResponse, maximumFileSize, validateAttachment, type TicketAttachment } from '../src/tickets/attachments'

const attachment: TicketAttachment = {
  id: 1, ticketId: 1, originalName: 'test.txt', mimeType: 'text/plain', sizeBytes: 10,
  createdAt: '2026-10-13T00:00:00Z', uploadedBy: { id: 1, name: 'Author', role: 'user' },
}

test('file validation: empty, oversized, unsupported and permitted formats', () => {
  assert.ok(validateAttachment({ name: 'a.txt', size: 0 }))
  assert.ok(validateAttachment({ name: 'a.txt', size: maximumFileSize + 1 }))
  for (const name of ['a.exe', 'a.svg', 'a.html', 'a', 'a.pdf.exe']) {
    assert.ok(validateAttachment({ name, size: 10 }), name)
  }
  for (const extension of ['PNG', 'jpg', 'jpeg', 'webp', 'pdf', 'txt', 'docx']) {
    assert.equal(validateAttachment({ name: `a.${extension}`, size: maximumFileSize }), '')
  }
})

test('deletion controls follow uploader/admin permissions for all roles', () => {
  for (const role of ['user', 'engineer']) {
    assert.equal(canDeleteAttachment({ id: 1, name: '', email: '', role }, attachment), true)
    assert.equal(canDeleteAttachment({ id: 2, name: '', email: '', role }, attachment), false)
  }
  assert.equal(canDeleteAttachment({ id: 2, name: '', email: '', role: 'admin' }, attachment), true)
  assert.equal(canDeleteAttachment(null, attachment), false)
})

test('401 clears session; errors and non-JSON failures are handled; 204 needs no JSON', async () => {
  let cleared = 0
  await assert.rejects(checkAttachmentResponse(new Response(null, { status: 401 }), () => cleared++), /Сессия/)
  assert.equal(cleared, 1)
  for (const [status, message] of [[403, /прав/], [404, /найдены/], [413, /лимит/], [415, /формату/], [500, /операцию/]] as const) {
    await assert.rejects(checkAttachmentResponse(new Response('not JSON', { status }), () => cleared++), message)
  }
  await assert.rejects(checkAttachmentResponse(Response.json({ message: 'Attachment was removed from the ticket; physical cleanup is pending' }, { status: 500 }), () => cleared++), /удалено из заявки/)
  await checkAttachmentResponse(new Response(null, { status: 204 }), () => cleared++)
  assert.equal(cleared, 1)
})
