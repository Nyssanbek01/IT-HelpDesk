import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yauzl from 'yauzl'

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const attachmentRoot = resolve(process.env.TICKET_UPLOADS_DIR ?? join(backendRoot, 'uploads', 'tickets'))
export const attachmentTempRoot = join(attachmentRoot, '.tmp')
export const attachmentTrashRoot = join(attachmentRoot, '.trash')

const acceptedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.txt', '.docx'])
const formatMap = {
  png: { mimeType: 'image/png', extension: 'png', inputExtensions: ['.png'] },
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg', inputExtensions: ['.jpg', '.jpeg'] },
  webp: { mimeType: 'image/webp', extension: 'webp', inputExtensions: ['.webp'] },
  pdf: { mimeType: 'application/pdf', extension: 'pdf', inputExtensions: ['.pdf'] },
  txt: { mimeType: 'text/plain; charset=utf-8', extension: 'txt', inputExtensions: ['.txt'] },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx', inputExtensions: ['.docx'] },
} as const

export type DetectedAttachment = {
  originalName: string
  extension: string
  mimeType: string
  sizeBytes: number
}

export function createStorageKey(extension: string) {
  return `${randomUUID()}.${extension}`
}

export function isSafeStorageKey(storageKey: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|txt|docx)$/i.test(storageKey)
}

export function resolveAttachmentPath(storageKey: string) {
  if (!isSafeStorageKey(storageKey)) {
    throw new Error('Invalid attachment storage key')
  }
  const filePath = resolve(attachmentRoot, storageKey)
  if (dirname(filePath) !== attachmentRoot) {
    throw new Error('Invalid attachment storage path')
  }
  return filePath
}

export async function ensureAttachmentDirectories() {
  await Promise.all([
    mkdir(attachmentRoot, { recursive: true }),
    mkdir(attachmentTempRoot, { recursive: true }),
    mkdir(attachmentTrashRoot, { recursive: true }),
  ])
}

function sanitizeOriginalName(originalName: string, expectedExtensions: readonly string[]) {
  const baseName = originalName.replace(/\\/g, '/').split('/').pop() ?? ''
  const safeName = Array.from(baseName.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 180).join('')
  if (!safeName || !expectedExtensions.includes(extname(safeName).toLowerCase())) {
    throw new Error('File name extension does not match file content')
  }
  return safeName
}

async function validateDocx(buffer: Buffer) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    yauzl.fromBuffer(buffer, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, zipFile) => {
      if (error || !zipFile) {
        rejectPromise(error ?? new Error('Invalid DOCX archive'))
        return
      }

      let entryCount = 0
      let contentTypesFound = false
      let documentFound = false
      let settled = false
      const finish = (reason?: Error) => {
        if (settled) return
        settled = true
        zipFile.close()
        if (reason) rejectPromise(reason)
        else if (contentTypesFound && documentFound) resolvePromise()
        else rejectPromise(new Error('DOCX archive is missing required Office document parts'))
      }

      zipFile.on('error', (zipError: Error) => finish(zipError))
      zipFile.on('entry', (entry) => {
        entryCount += 1
        if (entryCount > 10000 || entry.isEncrypted()) {
          finish(new Error('DOCX archive exceeds safe structure limits'))
          return
        }
        const segments = entry.fileName.replace(/\\/g, '/').split('/')
        if (entry.fileName.startsWith('/') || segments.includes('..')) {
          finish(new Error('DOCX archive contains an unsafe path'))
          return
        }
        if (entry.fileName === '[Content_Types].xml') contentTypesFound = true
        if (entry.fileName === 'word/document.xml') documentFound = true
        zipFile.readEntry()
      })
      zipFile.on('end', () => finish())
      zipFile.readEntry()
    })
  })
}

export async function inspectAttachmentFile(filePath: string, originalName: string): Promise<DetectedAttachment> {
  const fileStats = await stat(filePath)
  if (!fileStats.isFile() || fileStats.size < 1 || fileStats.size > 10 * 1024 * 1024) {
    throw new Error('File size must be between 1 byte and 10 MB')
  }
  const buffer = await readFile(filePath)
  let format: keyof typeof formatMap | null = null

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    format = 'png'
  } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    format = 'jpeg'
  } else if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    format = 'webp'
  } else if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') {
    format = 'pdf'
  } else if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3])) {
    try {
      await validateDocx(buffer)
      format = 'docx'
    } catch {
      throw new Error('File is not a valid DOCX document')
    }
  } else {
    const extension = extname(originalName.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase()
    if (extension === '.txt') {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Invalid text content')
        const prefix = text.trimStart().slice(0, 4096)
        if (/^(?:<!doctype\s+html|<html\b|<svg\b|<script\b)/i.test(prefix)) throw new Error('Markup is not allowed')
        format = 'txt'
      } catch {
        throw new Error('File is not valid UTF-8 plain text')
      }
    }
  }

  if (!format) throw new Error('File content type is not allowed')
  const detected = formatMap[format]
  const sanitizedName = sanitizeOriginalName(originalName, detected.inputExtensions)
  const submittedExtension = extname(sanitizedName).toLowerCase()
  if (!acceptedExtensions.has(submittedExtension)) throw new Error('File extension is not allowed')

  return {
    originalName: sanitizedName,
    extension: detected.extension,
    mimeType: detected.mimeType,
    sizeBytes: buffer.length,
  }
}

export async function moveToTrash(storageKey: string): Promise<string | null> {
  const source = resolveAttachmentPath(storageKey)
  const trashPath = join(attachmentTrashRoot, `${randomUUID()}.trash`)
  try {
    await rename(source, trashPath)
    return trashPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function restoreFromTrash(trashPath: string | null, storageKey: string) {
  if (!trashPath) return
  await rename(trashPath, resolveAttachmentPath(storageKey))
}

export async function removeTrashFile(trashPath: string | null) {
  if (!trashPath) return
  await rm(trashPath, { force: true })
}

export async function removeAttachmentFile(storageKey: string) {
  await rm(resolveAttachmentPath(storageKey), { force: true })
}

export async function removeTemporaryFile(filePath?: string) {
  if (!filePath) return
  const resolved = resolve(filePath)
  if (dirname(resolved) !== attachmentTempRoot) throw new Error('Invalid temporary attachment path')
  await rm(resolved, { force: true })
}

export function isPathInsideAttachmentRoot(filePath: string) {
  const resolved = resolve(filePath)
  const relativePath = relative(attachmentRoot, resolved)
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

export function getExtensionForMimeType(mimeType: string) {
  const format = Object.values(formatMap).find((value) => value.mimeType === mimeType)
  return format?.extension
}
