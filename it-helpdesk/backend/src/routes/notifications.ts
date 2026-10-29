import { Router, type RequestHandler } from 'express'
import { prisma } from '../db/prisma.js'
import { authenticateToken } from '../middleware/authenticateToken.js'
import { hasTicketAccess } from '../tickets/access.js'

const router = Router()
const select = {
  id: true, type: true, title: true, message: true, isRead: true, createdAt: true, readAt: true,
  ticket: { select: { id: true, userId: true } },
} as const

function safeNotification(item: { id: number; type: string; title: string; message: string; isRead: boolean; createdAt: Date; readAt: Date | null; ticket: { id: number; userId: number } | null }, user: { userId: number; role: string }) {
  const { ticket, ...fields } = item
  const available = ticket !== null && hasTicketAccess(user.role, user.userId, ticket)
  return {
    ...fields,
    ...(!available ? { type: null, title: 'Заявка недоступна', message: 'Заявка удалена или у вас больше нет доступа.' } : {}),
    ticketId: available ? ticket.id : null,
    ticketAvailable: available,
  }
}

const currentRecipient: RequestHandler = async (request, response, next) => {
  try {
    if (!Number.isSafeInteger(request.authUser!.userId) || request.authUser!.userId < 1 || request.authUser!.userId > 2147483647) {
      response.status(401).json({ message: 'Authentication required' }); return
    }
    const user = await prisma.user.findUnique({ where: { id: request.authUser!.userId }, select: { id: true, role: true } })
    if (!user) { response.status(401).json({ message: 'Authentication required' }); return }
    request.authUser = { userId: user.id, role: user.role }
    response.setHeader('Cache-Control', 'no-store')
    next()
  } catch { response.status(500).json({ message: 'Unable to verify notification recipient' }) }
}

router.use(authenticateToken, currentRecipient)

router.get('/unread-count', async (request, response) => {
  try {
    const count = await prisma.notification.count({ where: { recipientId: request.authUser!.userId, isRead: false } })
    response.json({ count })
  } catch { response.status(500).json({ message: 'Unable to count notifications' }) }
})

router.get('/', async (request, response) => {
  const { page = '1', limit = '20', unreadOnly = 'false' } = request.query
  const validInteger = (value: unknown, maximum: number) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= maximum
  if (Object.keys(request.query).some((key) => !['page', 'limit', 'unreadOnly'].includes(key)) || !validInteger(page, 1_000_000) || !validInteger(limit, 100) || (unreadOnly !== 'true' && unreadOnly !== 'false')) {
    response.status(400).json({ message: 'Invalid notification query parameters' }); return
  }
  const user = request.authUser!
  const where = { recipientId: user.userId, ...(unreadOnly === 'true' ? { isRead: false } : {}) }
  try {
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (Number(page) - 1) * Number(limit), take: Number(limit) }),
      prisma.notification.count({ where }),
    ])
    response.json({ items: items.map((item) => safeNotification(item, user)), total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) })
  } catch { response.status(500).json({ message: 'Unable to load notifications' }) }
})

router.patch('/read-all', async (request, response) => {
  try {
    const result = await prisma.notification.updateMany({ where: { recipientId: request.authUser!.userId, isRead: false }, data: { isRead: true, readAt: new Date() } })
    response.json({ updated: result.count })
  } catch { response.status(500).json({ message: 'Unable to mark notifications read' }) }
})

router.patch('/:id/read', async (request, response) => {
  const value = request.params.id
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    response.status(400).json({ message: 'Invalid notification id' }); return
  }
  const user = request.authUser!
  const where = { id: Number(value), recipientId: user.userId }
  try {
    const item = await prisma.$transaction(async (transaction) => {
      await transaction.notification.updateMany({ where: { ...where, isRead: false }, data: { isRead: true, readAt: new Date() } })
      return transaction.notification.findFirst({ where, select })
    })
    if (!item) { response.status(404).json({ message: 'Notification not found' }); return }
    response.json(safeNotification(item, user))
  } catch { response.status(500).json({ message: 'Unable to mark notification read' }) }
})

export default router
