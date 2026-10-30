export type AnalyticsRange = { dateFrom: string; dateTo: string; timezone: string; interval: string; engineerId: number | null; asOf: string }
export type AnalyticsShare = { numerator: number; denominator: number; percent: number | null; unknown: number }
export type AnalyticsOverview = {
  range: AnalyticsRange; created: number; resolved: number; activeNow: number; activeAtPeriodEnd: number | null; activeAtPeriodEndReason: string; distributionsBasis: string
  statuses: Record<string, number>; priorities: Record<string, number>
  averageResponse: { milliseconds: number | null; samples: number; excluded: number; basis: string }
  averageResolution: { milliseconds: number | null; samples: number; basis: string }
  resolutionSla: AnalyticsShare; unplacedResolvedGlobal: number; excludedResolutionEvents: number
}
export type AnalyticsTrend = { range: AnalyticsRange; buckets: Array<{ bucket: string; created: number; resolved: number }> }
export type AnalyticsEngineers = { range: AnalyticsRange; options: Array<{ id: number; name: string }>; items: Array<{ id: number; name: string; activeAssigned: number; resolved: number; averageResolutionMs: number | null; resolutionSla: AnalyticsShare }>; attribution: { unknownActor: number; otherActor: number; rule: string } }
export type AnalyticsSla = { range: AnalyticsRange; response: AnalyticsShare; resolution: AnalyticsShare; basis: string }
export function analyticsDuration(milliseconds: number | null) {
  if (milliseconds === null) return 'Нет достоверных данных'
  const minutes = milliseconds / 60000
  return minutes >= 60 ? `${(minutes / 60).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч` : `${minutes.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} мин`
}
