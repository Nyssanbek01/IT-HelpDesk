import { slaClock } from '../sla/service.js'
export class AnalyticsLimitError extends Error {}

export type AnalyticsQuery = { from: Date; to: Date; asOf: Date; dateFrom: string; dateTo: string; interval: 'day' | 'week' | 'month'; engineerId: number | null }
const day = 86400000
function parseDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Dates must use YYYY-MM-DD')
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(+date) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9998 || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid ISO date')
  return date
}
export function parseAnalyticsQuery(values: Record<string, unknown>, now = slaClock.now()): AnalyticsQuery {
  if (Object.keys(values).some((key) => !['dateFrom', 'dateTo', 'interval', 'engineerId'].includes(key)) || Object.values(values).some((value) => typeof value !== 'string')) throw new Error('Unknown or repeated analytics parameter')
  const q = values as Record<string, string>
  const today = parseDay(now.toISOString().slice(0, 10))
  const endDay = q.dateTo !== undefined ? parseDay(q.dateTo) : today
  const from = q.dateFrom !== undefined ? parseDay(q.dateFrom) : new Date(+endDay - 29 * day)
  const to = new Date(+endDay + day)
  if (from.getUTCFullYear() < 1 || +from >= +to || (+to - +from) / day > 366) throw new Error('Period must contain 1 to 366 UTC days')
  const interval = q.interval ?? 'day'
  if (!['day', 'week', 'month'].includes(interval)) throw new Error('Invalid interval')
  const id = q.engineerId
  if (id !== undefined && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647)) throw new Error('Invalid engineerId')
  return { from, to, asOf: new Date(Math.min(+to, +now)), dateFrom: from.toISOString().slice(0, 10), dateTo: endDay.toISOString().slice(0, 10), interval: interval as AnalyticsQuery['interval'], engineerId: id === undefined ? null : Number(id) }
}
export function rangeMetadata(q: AnalyticsQuery) {
  return { dateFrom: q.dateFrom, dateTo: q.dateTo, fromInclusive: q.from, toExclusive: q.to, asOf: q.asOf, timezone: 'UTC', interval: q.interval, engineerId: q.engineerId }
}
