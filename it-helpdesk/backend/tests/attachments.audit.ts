import 'dotenv/config'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { attachmentRoot, attachmentTempRoot, attachmentTrashRoot } from '../src/files/storage.js'

async function files(directory: string) {
  return (await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })).filter((entry) => entry.isFile()).map((entry) => entry.name)
}

try {
  const [users, tickets, comments, history, attachments] = await Promise.all([
    prisma.user.count(), prisma.ticket.count(), prisma.ticketComment.count(), prisma.ticketHistory.count(),
    prisma.ticketAttachment.findMany({ select: { storageKey: true, sizeBytes: true } }),
  ])
  const stored = await files(attachmentRoot)
  const referenced = new Set(attachments.map((a) => a.storageKey))
  let mismatchedSizes = 0
  for (const attachment of attachments) {
    if (stored.includes(attachment.storageKey) && (await stat(join(attachmentRoot, attachment.storageKey))).size !== attachment.sizeBytes) mismatchedSizes++
  }
  console.log(JSON.stringify({
    mode: 'read-only', users, tickets, comments, history, attachments: attachments.length,
    storedFiles: stored.length, orphanedFiles: stored.filter((name) => !referenced.has(name)).length,
    missingFiles: attachments.filter((a) => !stored.includes(a.storageKey)).length, mismatchedSizes,
    temporaryFiles: (await files(attachmentTempRoot)).length, trashFiles: (await files(attachmentTrashRoot)).length,
  }, null, 2))
} finally {
  await prisma.$disconnect()
}
