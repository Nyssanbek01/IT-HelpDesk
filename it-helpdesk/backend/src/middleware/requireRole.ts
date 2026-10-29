import type { RequestHandler } from 'express'
import { prisma } from '../db/prisma.js'

export function requireRole(...roles: string[]): RequestHandler {
  return async (request, response, next) => {
    if (!request.authUser) {
      response.status(401).json({ message: 'Authentication required' })
      return
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: request.authUser.userId },
        select: { role: true },
      })
      if (!user) {
        response.status(401).json({ message: 'Authentication required' })
        return
      }

      request.authUser.role = user.role
      if (!roles.includes(user.role)) {
        response.status(403).json({ message: 'You do not have permission to access this resource' })
        return
      }

      next()
    } catch {
      response.status(500).json({ message: 'Unable to verify user role' })
    }
  }
}