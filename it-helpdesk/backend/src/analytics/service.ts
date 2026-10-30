import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { AnalyticsLimitError, rangeMetadata, type AnalyticsQuery } from './query.js'

type Database = Prisma.TransactionClient
export type Share = { numerator: number; denominator: number; percent: number | null; unknown: number }
const share = (met: number, breached: number, unknown: number): Share => ({ numerator: met, denominator: met + breached, percent: met + breached ? Math.round(met / (met + breached) * 1000) / 10 : null, unknown })

function ctes(q: AnalyticsQuery) {
  const assigned = q.engineerId === null ? Prisma.sql`TRUE` : Prisma.sql`t."assignedEngineerId" = ${q.engineerId}`
  const actor = q.engineerId === null ? Prisma.sql`TRUE` : Prisma.sql`ra.actor_id = ${q.engineerId}`
  return Prisma.sql`
    WITH bounds AS (
      SELECT (${q.from}::timestamptz AT TIME ZONE 'UTC') AS start_at,
        (${q.to}::timestamptz AT TIME ZONE 'UTC') AS end_at,
        (${q.asOf}::timestamptz AT TIME ZONE 'UTC') AS observed_at
    ), resolution_actor AS (
      SELECT h."ticketId", CASE WHEN COUNT(DISTINCT h."actorId") = 1 THEN MIN(h."actorId") ELSE NULL END AS actor_id
      FROM "TicketHistory" h JOIN "Ticket" t ON t.id = h."ticketId" CROSS JOIN bounds b
      WHERE h.action = 'status_changed' AND h."newValue" = 'resolved' AND h."oldValue" IS DISTINCT FROM 'resolved'
        AND t."resolvedAt" >= b.start_at AND t."resolvedAt" < b.end_at AND t."resolvedAt" <= b.observed_at
        AND h."createdAt" >= t."createdAt"
        AND ABS(EXTRACT(EPOCH FROM (h."createdAt" - t."resolvedAt"))) <= 5
      GROUP BY h."ticketId"
    ), created AS (
      SELECT t.id, t.status, t.priority, t."createdAt", t."firstRespondedAt", t."slaTrackedFromCreation", t."responseDueAt" FROM "Ticket" t CROSS JOIN bounds b
      WHERE t."createdAt" >= b.start_at AND t."createdAt" < b.end_at AND t."createdAt" <= b.observed_at AND ${assigned}
    ), resolved AS (
      SELECT t.id, t."createdAt", t."resolvedAt", t."resolutionDueAt", ra.actor_id FROM "Ticket" t LEFT JOIN resolution_actor ra ON ra."ticketId" = t.id CROSS JOIN bounds b
      WHERE t."resolvedAt" >= b.start_at AND t."resolvedAt" < b.end_at AND t."resolvedAt" <= b.observed_at
        AND t."resolvedAt" >= t."createdAt" AND ${actor}
    )`
}

export async function analyticsOverview(q: AnalyticsQuery, db: Database = prisma) {
  type Row = { created: number; resolved: number; activeNow: number; responseMs: number | null; responseSamples: number; resolutionMs: number | null; resolutionSamples: number; met: number; breached: number; unknown: number; unplacedResolvedGlobal: number; excludedResolutionEvents: number; statuses: Record<string, number>; priorities: Record<string, number> }
  const assigned = q.engineerId === null ? Prisma.sql`TRUE` : Prisma.sql`t."assignedEngineerId" = ${q.engineerId}`
  const [row] = await db.$queryRaw<Row[]>(Prisma.sql`${ctes(q)}
    SELECT (SELECT COUNT(*)::int FROM created) AS created,
      (SELECT COUNT(*)::int FROM resolved) AS resolved,
      (SELECT COUNT(*)::int FROM "Ticket" t WHERE t.status <> 'resolved' AND ${assigned}) AS "activeNow",
      (SELECT AVG(EXTRACT(EPOCH FROM ("firstRespondedAt" - "createdAt")) * 1000)::float8 FROM created CROSS JOIN bounds b
        WHERE "slaTrackedFromCreation" AND "firstRespondedAt" >= "createdAt" AND "firstRespondedAt" < b.end_at AND "firstRespondedAt" <= b.observed_at) AS "responseMs",
      (SELECT COUNT(*)::int FROM created CROSS JOIN bounds b WHERE "slaTrackedFromCreation" AND "firstRespondedAt" >= "createdAt" AND "firstRespondedAt" < b.end_at AND "firstRespondedAt" <= b.observed_at) AS "responseSamples",
      (SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) * 1000)::float8 FROM resolved) AS "resolutionMs",
      (SELECT COUNT(*)::int FROM resolved) AS "resolutionSamples",
      (SELECT COUNT(*)::int FROM resolved WHERE "resolvedAt" <= "resolutionDueAt") AS met,
      (SELECT COUNT(*)::int FROM resolved WHERE "resolvedAt" > "resolutionDueAt") AS breached,
      (SELECT COUNT(*)::int FROM resolved WHERE "resolutionDueAt" IS NULL) AS unknown,
      (SELECT COUNT(*)::int FROM "Ticket" WHERE status = 'resolved' AND "resolvedAt" IS NULL) AS "unplacedResolvedGlobal",
      (SELECT COUNT(*)::int FROM "Ticket" t CROSS JOIN bounds b WHERE t."resolvedAt" >= b.start_at AND t."resolvedAt" < b.end_at AND t."resolvedAt" <= b.observed_at AND t."resolvedAt" < t."createdAt") AS "excludedResolutionEvents",
      COALESCE((SELECT jsonb_object_agg(status, count) FROM (SELECT status, COUNT(*)::int AS count FROM created GROUP BY status) s), '{}'::jsonb) AS statuses,
      COALESCE((SELECT jsonb_object_agg(priority, count) FROM (SELECT priority, COUNT(*)::int AS count FROM created GROUP BY priority) s), '{}'::jsonb) AS priorities`)
  return { range: rangeMetadata(q), created: row.created, resolved: row.resolved, activeNow: row.activeNow,
    activeAtPeriodEnd: null, activeAtPeriodEndReason: 'Полная история состояний не гарантирована; текущее состояние не выдаётся за историческое.',
    distributionsBasis: 'Текущее состояние заявок, созданных за период; фильтр инженера — текущее назначение.',
    statuses: row.statuses, priorities: row.priorities,
    averageResponse: { milliseconds: row.responseMs, samples: row.responseSamples, excluded: row.created - row.responseSamples, basis: 'Созданы за период, достоверная реакция до конца периода/текущего момента; текущий назначенный инженер.' },
    averageResolution: { milliseconds: row.resolutionMs, samples: row.resolutionSamples, basis: 'Достоверно решены за период; исполнитель определяется историей.' },
    resolutionSla: share(row.met, row.breached, row.unknown), unplacedResolvedGlobal: row.unplacedResolvedGlobal, excludedResolutionEvents: row.excludedResolutionEvents }
}

export async function analyticsTrend(q: AnalyticsQuery, db: Database = prisma) {
  const rows = await db.$queryRaw<Array<{ bucket: Date; created: number; resolved: number }>>(Prisma.sql`${ctes(q)},
    buckets AS (SELECT generate_series(date_trunc(${q.interval}, ${q.from}::timestamptz AT TIME ZONE 'UTC'),
      date_trunc(${q.interval}, (${q.to}::timestamptz AT TIME ZONE 'UTC') - INTERVAL '1 millisecond'),
      CASE ${q.interval} WHEN 'day' THEN INTERVAL '1 day' WHEN 'week' THEN INTERVAL '1 week' ELSE INTERVAL '1 month' END) AS bucket),
    c AS (SELECT date_trunc(${q.interval}, "createdAt") AS bucket, COUNT(*)::int AS count FROM created GROUP BY 1),
    r AS (SELECT date_trunc(${q.interval}, "resolvedAt") AS bucket, COUNT(*)::int AS count FROM resolved GROUP BY 1)
    SELECT b.bucket, COALESCE(c.count, 0)::int AS created, COALESCE(r.count, 0)::int AS resolved
      FROM buckets b LEFT JOIN c USING(bucket) LEFT JOIN r USING(bucket) ORDER BY b.bucket`)
  return { range: rangeMetadata(q), buckets: rows.map((row) => ({ ...row, bucket: row.bucket.toISOString() })) }
}

export async function analyticsSla(q: AnalyticsQuery, db: Database = prisma) {
  type Row = { responseMet: number; responseBreached: number; responseUnknown: number; resolutionMet: number; resolutionBreached: number; resolutionUnknown: number }
  const [row] = await db.$queryRaw<Row[]>(Prisma.sql`${ctes(q)}
    SELECT
      (SELECT COUNT(*)::int FROM created CROSS JOIN bounds b WHERE "slaTrackedFromCreation" AND "firstRespondedAt" >= "createdAt" AND "firstRespondedAt" < b.end_at AND "firstRespondedAt" <= b.observed_at AND "firstRespondedAt" <= "responseDueAt") AS "responseMet",
      (SELECT COUNT(*)::int FROM created CROSS JOIN bounds b WHERE "slaTrackedFromCreation" AND "firstRespondedAt" >= "createdAt" AND "firstRespondedAt" < b.end_at AND "firstRespondedAt" <= b.observed_at AND "firstRespondedAt" > "responseDueAt") AS "responseBreached",
      (SELECT COUNT(*)::int FROM created) AS "responseUnknown",
      (SELECT COUNT(*)::int FROM resolved WHERE "resolvedAt" <= "resolutionDueAt") AS "resolutionMet",
      (SELECT COUNT(*)::int FROM resolved WHERE "resolvedAt" > "resolutionDueAt") AS "resolutionBreached",
      (SELECT COUNT(*)::int FROM resolved WHERE "resolutionDueAt" IS NULL) AS "resolutionUnknown"`)
  return { range: rangeMetadata(q), response: share(row.responseMet, row.responseBreached, row.responseUnknown - row.responseMet - row.responseBreached), resolution: share(row.resolutionMet, row.resolutionBreached, row.resolutionUnknown), basis: 'Реакция — когорта создания; решение — события решения. Ожидающие/неизвестные этапы не входят в знаменатель. Правила SLA не изменены.' }
}

export async function analyticsEngineers(q: AnalyticsQuery, db: Database = prisma) {
  type Row = { id: number; name: string; activeAssigned: number; resolved: number; averageResolutionMs: number | null; met: number; breached: number; unknown: number }
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`${ctes(q)},
    workload AS (SELECT "assignedEngineerId" AS id, COUNT(*)::int AS count FROM "Ticket" WHERE status <> 'resolved' GROUP BY 1),
    performance AS (SELECT actor_id AS id, COUNT(*)::int AS count,
      AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) * 1000)::float8 AS average,
      COUNT(*) FILTER(WHERE "resolvedAt" <= "resolutionDueAt")::int AS met,
      COUNT(*) FILTER(WHERE "resolvedAt" > "resolutionDueAt")::int AS breached,
      COUNT(*) FILTER(WHERE "resolutionDueAt" IS NULL)::int AS unknown
      FROM resolved GROUP BY actor_id)
    SELECT u.id, u.name, COALESCE(w.count, 0)::int AS "activeAssigned", COALESCE(p.count, 0)::int AS resolved,
      p.average AS "averageResolutionMs", COALESCE(p.met, 0)::int AS met, COALESCE(p.breached, 0)::int AS breached, COALESCE(p.unknown, 0)::int AS unknown
      FROM "User" u LEFT JOIN workload w ON w.id = u.id LEFT JOIN performance p ON p.id = u.id
      WHERE u.role = 'engineer' ORDER BY u.name, u.id LIMIT 1001`)
  if (rows.length > 1000) throw new AnalyticsLimitError('Analytics supports at most 1000 current engineers')
  const [coverage] = await db.$queryRaw<Array<{ unknownActor: number; otherActor: number }>>(Prisma.sql`${ctes(q)}
    SELECT COUNT(*) FILTER(WHERE r.actor_id IS NULL)::int AS "unknownActor",
      COUNT(*) FILTER(WHERE r.actor_id IS NOT NULL AND (u.role IS NULL OR u.role <> 'engineer'))::int AS "otherActor"
      FROM resolved r LEFT JOIN "User" u ON u.id = r.actor_id`)
  return { range: rangeMetadata(q), options: rows.map(({ id, name }) => ({ id, name })), items: rows.filter((row) => q.engineerId === null || row.id === q.engineerId).map(({ met, breached, unknown, ...row }) => ({ ...row, resolutionSla: share(met, breached, unknown) })), attribution: { ...coverage, rule: 'Единственный actorId события status_changed → resolved в пределах ±5 секунд от достоверного resolvedAt. Текущее назначение не используется для атрибуции решения. Список включает текущих инженеров; прочие исполнители показаны отдельным числом.' } }
}

export async function analyticsExportData(q: AnalyticsQuery) {
  return prisma.$transaction(async (transaction) => ({ overview: await analyticsOverview(q, transaction), trend: await analyticsTrend(q, transaction), engineers: await analyticsEngineers(q, transaction), sla: await analyticsSla(q, transaction) }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 })
}
