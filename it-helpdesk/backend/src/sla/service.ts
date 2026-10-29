import type { Ticket } from '@prisma/client'

const minute = 60_000
export const slaClock = { now: () => new Date() }
export const slaPolicy = {
  high: { response: 15 * minute, resolution: 4 * 60 * minute },
  medium: { response: 60 * minute, resolution: 8 * 60 * minute },
  low: { response: 240 * minute, resolution: 24 * 60 * minute },
} as const
export const slaStatuses = ['on_time', 'approaching_deadline', 'overdue', 'met', 'breached', 'unknown'] as const
export type SlaStatus = typeof slaStatuses[number]
export type SlaStage = 'response' | 'resolution'
export type SlaTicket = Pick<Ticket, 'priority' | 'createdAt' | 'status' | 'responseDueAt' | 'resolutionDueAt' | 'firstRespondedAt' | 'resolvedAt' | 'slaTrackedFromCreation'>

export function deadlines(priority: string, createdAt: Date) {
  const policy = slaPolicy[priority as keyof typeof slaPolicy]
  return {
    responseDueAt: policy ? new Date(createdAt.getTime() + policy.response) : null,
    resolutionDueAt: policy ? new Date(createdAt.getTime() + policy.resolution) : null,
  }
}

function stageSla(ticket: SlaTicket, stage: SlaStage, now: Date) {
  const dueAt = stage === 'response' ? ticket.responseDueAt : ticket.resolutionDueAt
  const completedAt = stage === 'response' ? ticket.firstRespondedAt : ticket.resolvedAt
  const unknown = !dueAt || (stage === 'response' && !ticket.slaTrackedFromCreation) || (ticket.status === 'resolved' && !completedAt)
  let status: SlaStatus = 'unknown'
  let remainingMs: number | null = null
  if (!unknown && dueAt) {
    if (completedAt) status = completedAt.getTime() <= dueAt.getTime() ? 'met' : 'breached'
    else {
      remainingMs = dueAt.getTime() - now.getTime()
      const threshold = Math.max((dueAt.getTime() - ticket.createdAt.getTime()) * .2, 5 * minute)
      status = remainingMs <= 0 ? 'overdue' : remainingMs <= threshold ? 'approaching_deadline' : 'on_time'
    }
  }
  return { status, dueAt, completedAt, remainingMs }
}

export function ticketSla(ticket: SlaTicket, now = slaClock.now()) {
  return { serverNow: now, response: stageSla(ticket, 'response', now), resolution: stageSla(ticket, 'resolution', now) }
}

export function withSla<T extends SlaTicket>(ticket: T, now = slaClock.now()) {
  return { ...ticket, sla: ticketSla(ticket, now) }
}

export function validSlaFilter(status: unknown, stage: unknown) {
  return typeof status === 'string' && (status === 'all' || slaStatuses.includes(status as SlaStatus)) && typeof stage === 'string' && ['any', 'response', 'resolution'].includes(stage)
}

export function matchesSla(ticket: SlaTicket, status: string, stage: string, now: Date) {
  if (status === 'all') return true
  const sla = ticketSla(ticket, now)
  return stage === 'any' ? sla.response.status === status || sla.resolution.status === status : sla[stage as SlaStage].status === status
}

export function slaStatistics(tickets: SlaTicket[], now = slaClock.now()) {
  let responseOverdue = 0, resolutionOverdue = 0, approaching = 0, resolvedOnTime = 0, resolvedBreached = 0
  let responseMet = 0, responseBreached = 0
  for (const ticket of tickets) {
    const sla = ticketSla(ticket, now)
    if (sla.response.status === 'overdue') responseOverdue++
    if (sla.resolution.status === 'overdue') resolutionOverdue++
    if (ticket.status !== 'resolved' && (sla.response.status === 'approaching_deadline' || sla.resolution.status === 'approaching_deadline')) approaching++
    if (ticket.status === 'resolved' && sla.resolution.status === 'met') resolvedOnTime++
    if (ticket.status === 'resolved' && sla.resolution.status === 'breached') resolvedBreached++
    if (sla.response.status === 'met') responseMet++
    if (sla.response.status === 'breached') responseBreached++
  }
  const eligibleResolved = resolvedOnTime + resolvedBreached
  return {
    serverNow: now, activeTickets: tickets.filter((ticket) => ticket.status !== 'resolved').length,
    responseOverdue, resolutionOverdue, approaching, resolvedOnTime, resolvedBreached, eligibleResolved,
    compliancePercent: eligibleResolved ? Math.round(resolvedOnTime / eligibleResolved * 1000) / 10 : null,
    responseCompliancePercent: responseMet + responseBreached ? Math.round(responseMet / (responseMet + responseBreached) * 1000) / 10 : null,
    unknownResolved: tickets.filter((ticket) => ticket.status === 'resolved' && ticketSla(ticket, now).resolution.status === 'unknown').length,
  }
}
