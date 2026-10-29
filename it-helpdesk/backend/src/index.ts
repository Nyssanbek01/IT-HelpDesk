import 'dotenv/config'
import express from 'express'
import authRouter from './routes/auth.js'
import attachmentsRouter from './routes/attachments.js'
import adminRouter from './routes/admin.js'
import engineerRouter from './routes/engineer.js'
import ticketsRouter from './routes/tickets.js'
import notificationsRouter from './routes/notifications.js'
import { prisma } from './db/prisma.js'

const app = express()
const port = Number(process.env.PORT ?? 3000)

app.use(express.json({ limit: '16kb' }))

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    message: 'IT HelpDesk API is running',
  })
})

app.get('/api/db-health', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    response.json({
      status: 'ok',
      database: 'connected',
    })
  } catch {
    response.status(500).json({
      status: 'error',
      message: 'Database connection failed',
    })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/admin', adminRouter)
app.use('/api/tickets', attachmentsRouter)
app.use('/api/tickets', ticketsRouter)
app.use('/api/engineer/tickets', engineerRouter)

app.use((error: Error & { status?: number }, _request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (response.headersSent) {
    next(error)
    return
  }

  if (error.status === 400) {
    response.status(400).json({ message: 'Invalid JSON body' })
    return
  }

  response.status(500).json({ message: 'Internal server error' })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`IT HelpDesk API listening on port ${port}`)
})
