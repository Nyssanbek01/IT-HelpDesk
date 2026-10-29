import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { Router, type RequestHandler } from 'express'
import multer, { MulterError } from 'multer'
import { prisma } from '../db/prisma.js'
import { authenticateToken } from '../middleware/authenticateToken.js'
import { findAccessibleTicket } from '../tickets/access.js'
import { notifyTicket } from '../notifications/service.js'
import {
  attachmentTempRoot,
  ensureAttachmentDirectories,
  inspectAttachmentFile,
  moveToTrash,
  removeAttachmentFile,
  removeTemporaryFile,
  removeTrashFile,
  resolveAttachmentPath,
  restoreFromTrash,
} from '../files/storage.js'

const router = Router()
const maximumAttachmentsPerTicket = 10

const diskStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    mkdir(attachmentTempRoot, { recursive: true })
      .then(() => callback(null, attachmentTempRoot))
      .catch((error: Error) => callback(error, attachmentTempRoot))
  },
  filename: (_request, _file, callback) => callback(null, `${randomUUID()}.upload`),
})

const uploader = multer({
  storage: diskStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
})

router.use(authenticateToken)

const authorizeTicket: RequestHandler = async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) {
    response.status(404).json({ message: 'Ticket not found' })
    return
  }
  try {
    const ticket = await findAccessibleTicket(request, id)
    if (!ticket) {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    response.locals.ticketId = ticket.id
    next()
  } catch {
    response.status(500).json({ message: 'Unable to verify ticket access' })
  }
}

const parseSingleFile: RequestHandler = async (request, response, next) => {
  try {
    await ensureAttachmentDirectories()
    uploader.single('file')(request, response, (error: unknown) => {
      if (error instanceof MulterError) {
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
        response.status(status).json({
          message: error.code === 'LIMIT_FILE_SIZE'
            ? 'File exceeds the 10 MB limit'
            : 'Expected one multipart file field named file',
        })
        return
      }
      if (error) {
        response.status(400).json({ message: 'Unable to read uploaded file' })
        return
      }
      next()
    })
  } catch {
    response.status(500).json({ message: 'Unable to prepare upload storage' })
  }
}

router.get('/:id/attachments', authorizeTicket, async (_request, response) => {
  try {
    const attachments = await prisma.ticketAttachment.findMany({
      where: { ticketId: response.locals.ticketId as number },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        ticketId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true, role: true } },
      },
    })
    response.json(attachments)
  } catch {
    response.status(500).json({ message: 'Unable to load attachments' })
  }
})

router.post('/:id/attachments', authorizeTicket, parseSingleFile, async (request, response) => {
  const authUser = request.authUser
  const ticketId = response.locals.ticketId as number
  const temporaryPath = request.file?.path
  if (!authUser) {
    await removeTemporaryFile(temporaryPath).catch(() => undefined)
    response.status(401).json({ message: 'Authentication required' })
    return
  }
  if (!request.file || !temporaryPath) {
    response.status(400).json({ message: 'A file field named file is required' })
    return
  }

  let storageKey: string | null = null
  try {
    const inspected = await inspectAttachmentFile(temporaryPath, request.file.originalname)
    const candidateStorageKey = `${randomUUID()}.${inspected.extension}`
    let movedToFinal = false
    const outcome = await prisma.$transaction(async (transaction) => {
      const lockedTicket = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE
      `
      if (lockedTicket.length === 0) return { kind: 'missing' as const }
      const existingCount = await transaction.ticketAttachment.count({ where: { ticketId } })
      if (existingCount >= maximumAttachmentsPerTicket) return { kind: 'limit' as const }

      storageKey = candidateStorageKey
      await rename(temporaryPath, resolveAttachmentPath(candidateStorageKey))
      movedToFinal = true
      const attachment = await transaction.ticketAttachment.create({
        data: {
          ticketId,
          uploadedById: authUser.userId,
          originalName: inspected.originalName,
          storageKey: candidateStorageKey,
          mimeType: inspected.mimeType,
          sizeBytes: inspected.sizeBytes,
        },
        select: {
          id: true,
          ticketId: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          uploadedBy: { select: { id: true, name: true, role: true } },
        },
      })
      await transaction.ticketHistory.create({
        data: {
          ticketId,
          actorId: authUser.userId,
          action: 'attachment_added',
          oldValue: null,
          newValue: inspected.originalName,
        },
      })
      const ticket = await transaction.ticket.findUnique({ where: { id: ticketId } })
      if (ticket) await notifyTicket(transaction, ticket, authUser.userId, 'attachment_added')
      return { kind: 'created' as const, attachment }
    })

    if (outcome.kind === 'missing') {
      response.status(404).json({ message: 'Ticket not found' })
      return
    }
    if (outcome.kind === 'limit') {
      response.status(413).json({ message: 'A ticket can have at most 10 attachments' })
      return
    }
    response.status(201).json(outcome.attachment)
  } catch (error) {
    if (storageKey) await removeAttachmentFile(storageKey).catch(() => undefined)
    const validationMessage = error instanceof Error ? error.message : ''
    if (
      validationMessage.includes('File size') ||
      validationMessage.includes('File content') ||
      validationMessage.includes('File name extension') ||
      validationMessage.includes('DOCX') ||
      validationMessage.includes('archive') ||
      validationMessage.includes('text') ||
      validationMessage.includes('Markup')
    ) {
      response.status(415).json({ message: validationMessage })
      return
    }
    response.status(500).json({ message: 'Unable to save attachment' })
  } finally {
    await removeTemporaryFile(temporaryPath).catch(() => undefined)
  }
})

router.get('/:id/attachments/:attachmentId/download', authorizeTicket, async (request, response) => {
  const ticketId = response.locals.ticketId as number
  const attachmentId = Number(request.params.attachmentId)
  if (!Number.isSafeInteger(attachmentId) || attachmentId < 1) {
    response.status(404).json({ message: 'Attachment not found' })
    return
  }

  try {
    const attachment = await prisma.ticketAttachment.findFirst({
      where: { id: attachmentId, ticketId },
      select: { storageKey: true, originalName: true, mimeType: true },
    })
    if (!attachment) {
      response.status(404).json({ message: 'Attachment not found' })
      return
    }
    const filePath = resolveAttachmentPath(attachment.storageKey)
    await stat(filePath)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.type(attachment.mimeType)
    response.download(filePath, attachment.originalName, (error) => {
      if (!error || response.headersSent) return
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        response.status(404).json({ message: 'Attachment file is missing' })
        return
      }
      response.status(500).json({ message: 'Unable to download attachment' })
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      response.status(404).json({ message: 'Attachment file is missing' })
      return
    }
    response.status(500).json({ message: 'Unable to download attachment' })
  }
})

router.delete('/:id/attachments/:attachmentId', authorizeTicket, async (request, response) => {
  const authUser = request.authUser
  const ticketId = response.locals.ticketId as number
  const attachmentId = Number(request.params.attachmentId)
  if (!authUser) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }
  if (!Number.isSafeInteger(attachmentId) || attachmentId < 1) {
    response.status(404).json({ message: 'Attachment not found' })
    return
  }

  let trashPath: string | null = null
  let storageKey: string | null = null
  try {
    const outcome = await prisma.$transaction(async (transaction) => {
      const lockedTicket = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE
      `
      if (lockedTicket.length === 0) return { kind: 'missing' as const }
      const attachment = await transaction.ticketAttachment.findFirst({
        where: { id: attachmentId, ticketId },
        select: { id: true, storageKey: true, originalName: true, uploadedById: true },
      })
      if (!attachment) return { kind: 'missing' as const }
      if (authUser.role !== 'admin' && attachment.uploadedById !== authUser.userId) {
        return { kind: 'forbidden' as const }
      }

      storageKey = attachment.storageKey
      trashPath = await moveToTrash(attachment.storageKey)
      const deleted = await transaction.ticketAttachment.deleteMany({ where: { id: attachmentId, ticketId } })
      if (deleted.count === 0) return { kind: 'missing' as const }
      await transaction.ticketHistory.create({
        data: {
          ticketId,
          actorId: authUser.userId,
          action: 'attachment_deleted',
          oldValue: attachment.originalName,
          newValue: null,
        },
      })
      return { kind: 'deleted' as const }
    })

    if (outcome.kind === 'missing') {
      await restoreFromTrash(trashPath, storageKey ?? '')
      response.status(404).json({ message: 'Attachment not found' })
      return
    }
    if (outcome.kind === 'forbidden') {
      response.status(403).json({ message: 'You can delete only attachments you uploaded' })
      return
    }

    try {
      await removeTrashFile(trashPath)
    } catch {
      response.status(500).json({ message: 'Attachment was removed from the ticket; physical cleanup is pending' })
      return
    }
    response.status(204).end()
  } catch {
    await restoreFromTrash(trashPath, storageKey ?? '').catch(() => undefined)
    response.status(500).json({ message: 'Unable to delete attachment' })
  }
})

export default router
