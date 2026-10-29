import type { TicketSla } from './sla'
export type TicketStatus = 'new' | 'in_progress' | 'resolved'
export type TicketPriority = 'low' | 'medium' | 'high'

export type Ticket = {
  id: number
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  createdAt: string
  updatedAt: string
  userId: number
  assignedEngineerId: number | null
  responseDueAt?: string | null
  resolutionDueAt?: string | null
  firstRespondedAt?: string | null
  resolvedAt?: string | null
  slaTrackedFromCreation?: boolean
  sla?: TicketSla
}

export type EngineerTicket = Ticket & {
  user: { id: number; name: string; email: string }
  assignedEngineer: { id: number; name: string; email: string } | null
}

export type TicketComment = {
  id: number
  message: string
  ticketId: number
  createdAt: string
  user: { id: number; name: string; role: string }
}

export type TicketHistoryEntry = {
  id: number
  ticketId: number
  actorId: number
  action: string
  oldValue: string | null
  newValue: string | null
  createdAt: string
  actor: { id: number; name: string; role: string }
}

export const statusLabels: Record<TicketStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  resolved: 'Решена',
}

export const priorityLabels: Record<TicketPriority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
}

export function formatTicketDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
