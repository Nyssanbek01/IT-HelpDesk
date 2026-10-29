import type { Ticket, User } from '@prisma/client'
import type { Request } from 'express'
import { prisma } from '../db/prisma.js'

export type TicketWithAccess = Ticket

export function hasTicketAccess(role: string, userId: number, ticket: { userId: number }) {
  return role === 'engineer' || role === 'admin' || (role === 'user' && userId === ticket.userId)
}

export async function findAccessibleTicket(request: Request, ticketId: number) {
  const authUser = request.authUser
  if (!authUser) return null

  const currentUser = await prisma.user.findUnique({
    where: { id: authUser.userId },
    select: { role: true },
  })
  if (!currentUser) return null
  authUser.role = currentUser.role

  const where = currentUser.role === 'user'
    ? { id: ticketId, userId: authUser.userId }
    : currentUser.role === 'engineer' || currentUser.role === 'admin'
      ? { id: ticketId }
      : null

  if (!where) return null
  const ticket = await prisma.ticket.findFirst({ where })
  return ticket && hasTicketAccess(currentUser.role, authUser.userId, ticket) ? ticket : null
}

export async function findCommentAuthors(userIds: number[]) {
  const uniqueIds = [...new Set(userIds)]
  return prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, name: true, role: true },
  }) satisfies Promise<Pick<User, 'id' | 'name' | 'role'>[]>
}
