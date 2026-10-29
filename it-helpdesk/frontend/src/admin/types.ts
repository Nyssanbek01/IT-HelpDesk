import type { EngineerTicket } from '../tickets/types'

export type AdminUser = {
  id: number
  name: string
  email: string
  role: 'user' | 'engineer' | 'admin'
  createdAt: string
}

export type AdminEngineer = {
  id: number
  name: string
  email: string
  openAssignedTickets: number
}

export type AdminTicket = EngineerTicket

export type PaginatedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type AdminStats = {
  totalTickets: number
  newTickets: number
  inProgressTickets: number
  resolvedTickets: number
  totalUsers: number
  engineers: number
  unassignedTickets: number
}

export const adminRoleLabels: Record<AdminUser['role'], string> = {
  user: 'Пользователь',
  engineer: 'Инженер',
  admin: 'Администратор',
}
