import { prisma } from '../db/prisma.js'
import { hasTicketAccess } from '../tickets/access.js'
import { slaClock, ticketSla, type SlaStage } from './service.js'

// Unique event + notifications commit together. Row locks coordinate with take/resolve.
export async function checkSla(options: { now?: Date; ticketIds?: number[] } = {}) {
  let cursor = 0
  const result = { checked: 0, events: 0, notifications: 0 }
  while (true) {
    const candidates = await prisma.ticket.findMany({
      where: { id: { gt: cursor, ...(options.ticketIds ? { in: options.ticketIds } : {}) }, status: { not: 'resolved' }, slaTrackedFromCreation: true },
      select: { id: true }, orderBy: { id: 'asc' }, take: 200,
    })
    if (!candidates.length) break
    for (const candidate of candidates) {
      const outcome = await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${candidate.id} FOR UPDATE`
        const ticket = await transaction.ticket.findUnique({ where: { id: candidate.id } })
        const totals = { events: 0, notifications: 0 }
        if (!ticket || ticket.status === 'resolved' || !ticket.slaTrackedFromCreation) return totals
        const now = options.now ?? slaClock.now()
        const sla = ticketSla(ticket, now)
        const users = await transaction.user.findMany({
          where: { OR: [{ id: ticket.userId }, ...(ticket.assignedEngineerId ? [{ id: ticket.assignedEngineerId }] : []), { role: 'admin' }] },
          select: { id: true, role: true },
        })
        const recipients = users.filter((user) => hasTicketAccess(user.role, user.id, ticket))
        if (!recipients.length) return totals
        for (const stage of ['response', 'resolution'] as SlaStage[]) {
          const phase = sla[stage].status
          if (phase !== 'approaching_deadline' && phase !== 'overdue') continue
          const event = await transaction.ticketSlaEvent.createMany({ data: [{ ticketId: ticket.id, stage, phase, createdAt: now }], skipDuplicates: true })
          if (!event.count) continue
          const title = `${stage === 'response' ? 'Реакция' : 'Решение'}: ${phase === 'overdue' ? 'срок нарушен' : 'скоро дедлайн'}`
          const notices = await transaction.notification.createMany({ data: recipients.map((user) => ({
            recipientId: user.id, actorId: null, ticketId: ticket.id,
            type: `sla_${stage}_${phase}`, title, message: `${title} · заявка #${ticket.id}.`, createdAt: now,
          })) })
          totals.events += event.count
          totals.notifications += notices.count
        }
        return totals
      })
      result.checked++
      result.events += outcome.events
      result.notifications += outcome.notifications
    }
    cursor = candidates[candidates.length - 1].id
  }
  return result
}
