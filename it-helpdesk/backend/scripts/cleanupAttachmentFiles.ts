import 'dotenv/config'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { attachmentRoot, attachmentTempRoot, attachmentTrashRoot, isSafeStorageKey } from '../src/files/storage.js'

const staleBefore = Date.now() - 24 * 60 * 60 * 1000

async function removeStaleRegularFiles(directory: string, referencedKeys?: Set<string>) {
  let removed = 0
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return removed
    throw error
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (referencedKeys && !isSafeStorageKey(entry.name)) continue
    const filePath = join(directory, entry.name)
    const metadata = await stat(filePath)
    if (metadata.mtimeMs >= staleBefore) continue
    if (referencedKeys?.has(entry.name)) continue
    await rm(filePath, { force: true })
    removed += 1
  }
  return removed
}

async function main() {
  const referenced = await prisma.ticketAttachment.findMany({ select: { storageKey: true } })
  const referencedKeys = new Set(referenced.map((attachment) => attachment.storageKey))
  const orphaned = await removeStaleRegularFiles(attachmentRoot, referencedKeys)
  const temporary = await removeStaleRegularFiles(attachmentTempRoot)
  const trashed = await removeStaleRegularFiles(attachmentTrashRoot)
  console.log(`Attachment cleanup complete. Removed ${orphaned} orphan(s), ${temporary} stale temporary file(s), and ${trashed} stale trash file(s).`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Attachment cleanup failed')
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())