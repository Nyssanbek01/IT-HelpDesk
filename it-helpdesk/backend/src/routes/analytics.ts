import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { AnalyticsLimitError, parseAnalyticsQuery } from '../analytics/query.js'
import { analyticsOverview, analyticsTrend, analyticsEngineers, analyticsSla, analyticsExportData } from '../analytics/service.js'
import { analyticsCsv } from '../analytics/csv.js'

// Mounted after authenticateToken + requireRole('admin') in admin.ts.
const router = Router()
for (const kind of ['overview', 'tickets-trend', 'engineers', 'sla', 'export'] as const) {
  router.get(`/${kind}`, async (request, response) => {
    let query: ReturnType<typeof parseAnalyticsQuery>
    try { query = parseAnalyticsQuery(request.query as Record<string, unknown>) }
    catch (error) { response.status(400).json({ message: error instanceof Error ? error.message : 'Invalid analytics query' }); return }
    try {
      if (query.engineerId !== null) {
        const user = await prisma.user.findUnique({ where: { id: query.engineerId }, select: { role: true } })
        if (!user || user.role !== 'engineer') { response.status(400).json({ message: 'Selected engineer is unavailable' }); return }
      }
      response.setHeader('Cache-Control', 'no-store')
      if (kind === 'export') {
        const csv = analyticsCsv(await analyticsExportData(query))
        response.setHeader('Content-Type', 'text/csv; charset=utf-8')
        response.setHeader('Content-Disposition', `attachment; filename="helpdesk-analytics-${query.dateFrom}-${query.dateTo}.csv"`)
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.send(csv); return
      }
      const result = await prisma.$transaction(async (transaction) => kind === 'overview' ? analyticsOverview(query, transaction) : kind === 'tickets-trend' ? analyticsTrend(query, transaction) : kind === 'engineers' ? analyticsEngineers(query, transaction) : analyticsSla(query, transaction), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 })
      response.json(result)
    } catch (error) {
      if (error instanceof AnalyticsLimitError) { response.status(413).json({ message: error.message }); return }
      response.status(500).json({ message: 'Unable to generate analytics report' })
    }
  })
}
export default router
