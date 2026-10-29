import type { Prisma } from '@prisma/client'
import { hasTicketAccess } from '../tickets/access.js'

type NotificationType = 'ticket_created' | 'ticket_assigned' | 'ticket_taken' | 'ticket_resolved' | 'new_comment' | 'attachment_added' | 'ticket_unassigned'
type NotificationTicket = { id: number; userId: number; assignedEngineerId: number | null }
const titles: Record<NotificationType, string> = {
  ticket_created: 'Новая заявка', ticket_assigned: 'Изменено назначение',
  ticket_taken: 'Заявка взята в работу', ticket_resolved: 'Заявка решена',
  new_comment: 'Новый комментарий', attachment_added: 'Добавлено вложение',
  ticket_unassigned: 'Назначение снято',
}

export async function notifyTicket(
  transaction: Prisma.TransactionClient,
  ticket: NotificationTicket,
  actorId: number,
  type: NotificationType,
  previousEngineerId?: number | null,
) {
  let candidates: number[]
  if (type === 'ticket_created') {
    const engineers = await transaction.user.findMany({ where: { role: 'engineer' }, select: { id: true } })
    candidates = engineers.map((user) => user.id)
  } else if (type === 'ticket_assigned') {
    candidates = [ticket.userId, ...(ticket.assignedEngineerId ? [ticket.assignedEngineerId] : [])]
  } else if (type === 'ticket_unassigned') {
    candidates = [ticket.userId, ...(previousEngineerId ? [previousEngineerId] : [])]
  } else if (type === 'ticket_taken' || type === 'ticket_resolved') {
    candidates = [ticket.userId]
  } else {
    const actor = await transaction.user.findUnique({ where: { id: actorId }, select: { role: true } })
    if (!actor || !hasTicketAccess(actor.role, actorId, ticket)) return
    candidates = actor.role === 'user'
      ? ticket.assignedEngineerId ? [ticket.assignedEngineerId] : []
      : actor.role === 'engineer' || actor.role === 'admin' ? [ticket.userId] : []
  }
  const ids = [...new Set(candidates)].filter((id) => id !== actorId)
  if (!ids.length) return
  const recipients = await transaction.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } })
  const data = recipients.filter((user) => hasTicketAccess(user.role, user.id, ticket)).map((user) => ({
    recipientId: user.id, actorId, ticketId: ticket.id, type,
    title: titles[type], message: `${titles[type]} · заявка #${ticket.id}.`,
  }))
  if (data.length) await transaction.notification.createMany({ data })
}
