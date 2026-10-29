import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { deadlines, ticketSla } from '../src/sla/service.js'
try {
  const tickets = await prisma.ticket.findMany()
  let deadlineMismatches = 0, falselyBreachedLegacyResolved = 0
  for (const ticket of tickets) {
    const expected = deadlines(ticket.priority, ticket.createdAt)
    if (ticket.responseDueAt?.getTime() !== expected.responseDueAt?.getTime() || ticket.resolutionDueAt?.getTime() !== expected.resolutionDueAt?.getTime()) deadlineMismatches++
    const sla = ticketSla(ticket)
    if (!ticket.slaTrackedFromCreation && ticket.status === 'resolved' && !ticket.resolvedAt && sla.resolution.status !== 'unknown') falselyBreachedLegacyResolved++
  }
  console.log(JSON.stringify({ mode: 'read-only', tickets: tickets.length, trackedFromCreation: tickets.filter((ticket) => ticket.slaTrackedFromCreation).length, legacy: tickets.filter((ticket) => !ticket.slaTrackedFromCreation).length, deadlineMismatches, falselyBreachedLegacyResolved, slaEvents: await prisma.ticketSlaEvent.count(), slaNotifications: await prisma.notification.count({ where: { type: { startsWith: 'sla_' } } }) }, null, 2))
} finally { await prisma.$disconnect() }
