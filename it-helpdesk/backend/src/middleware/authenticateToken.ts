import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/auth.js'

export const authenticateToken: RequestHandler = (request, response, next) => {
  const authorization = request.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)

  if (!match) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }

  try {
    const payload = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] })

    if (
      typeof payload === 'string' ||
      typeof payload.userId !== 'number' ||
      typeof payload.role !== 'string'
    ) {
      response.status(401).json({ message: 'Invalid or expired token' })
      return
    }

    request.authUser = {
      userId: payload.userId,
      role: payload.role,
    }
    next()
  } catch {
    response.status(401).json({ message: 'Invalid or expired token' })
  }
}