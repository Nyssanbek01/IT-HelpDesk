import { Prisma } from '@prisma/client'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/auth.js'
import { prisma } from '../db/prisma.js'
import { authenticateToken } from '../middleware/authenticateToken.js'

const router = Router()
const userResponse = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const

router.post('/register', async (request, response) => {
  const body = request.body as Record<string, unknown> | undefined
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!name || !email || !password) {
    response.status(400).json({ message: 'Name, email, and password are required' })
    return
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ message: 'A valid email is required' })
    return
  }

  if (password.length < 8) {
    response.status(400).json({ message: 'Password must be at least 8 characters long' })
    return
  }

  if (Buffer.byteLength(password, 'utf8') > 72) {
    response.status(400).json({ message: 'Password must not exceed 72 UTF-8 bytes' })
    return
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        role: 'user',
      },
      select: userResponse,
    })

    response.status(201).json({
      message: 'User registered successfully',
      user,
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      response.status(409).json({ message: 'Email is already registered' })
      return
    }

    response.status(500).json({ message: 'Internal server error' })
  }
})

router.post('/login', async (request, response) => {
  const body = request.body as Record<string, unknown> | undefined
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) {
    response.status(401).json({ message: 'Invalid email or password' })
    return
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        ...userResponse,
        password: true,
      },
    })

    if (!user || !(await bcrypt.compare(password, user.password))) {
      response.status(401).json({ message: 'Invalid email or password' })
      return
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '24h' },
    )

    response.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
  } catch {
    response.status(500).json({ message: 'Internal server error' })
  }
})

router.get('/me', authenticateToken, async (request, response) => {
  const authUser = request.authUser

  if (!authUser) {
    response.status(401).json({ message: 'Authentication required' })
    return
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      select: userResponse,
    })

    if (!user) {
      response.status(401).json({ message: 'Invalid or expired token' })
      return
    }

    response.json(user)
  } catch {
    response.status(500).json({ message: 'Internal server error' })
  }
})

export default router