import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAnalyticsQuery } from '../src/analytics/query.js'
import { csvCell } from '../src/analytics/csv.js'

test('analytics period: strict UTC days, inclusive end, 366-day bound and validated parameters', () => {
  const now = new Date('2035-02-01T12:00Z')
  const range = parseAnalyticsQuery({ dateFrom: '2035-01-01', dateTo: '2035-01-03', interval: 'week' }, now)
  assert.equal(range.from.toISOString(), '2035-01-01T00:00:00.000Z')
  assert.equal(range.to.toISOString(), '2035-01-04T00:00:00.000Z')
  assert.equal(range.asOf.toISOString(), '2035-01-04T00:00:00.000Z')
  assert.equal(+parseAnalyticsQuery({}, now).to - +parseAnalyticsQuery({}, now).from, 30 * 86400000)
  assert.equal(+parseAnalyticsQuery({ dateFrom: '2024-01-01', dateTo: '2024-12-31' }, now).to - +new Date('2024-01-01'), 366 * 86400000)
  for (const value of [{ dateFrom: '2035-02-30' }, { dateTo: 'x' }, { dateFrom: '2035-01-03', dateTo: '2035-01-01' }, { dateFrom: '2024-01-01', dateTo: '2025-01-01' }, { interval: 'year' }, { engineerId: '0' }, { engineerId: '1e2' }, { ownerId: '1' }, { interval: ['day', 'month'] }, { dateTo: '0001-01-01' }]) assert.throws(() => parseAnalyticsQuery(value, now))
})
test('CSV: quotes, delimiter, CR/LF, Unicode and hidden formula prefixes are neutralized', () => {
  assert.equal(csvCell('Иван, "инженер"\nстрока'), '"Иван, ""инженер""\nстрока"')
  assert.equal(csvCell(null), '""')
  for (const value of ['=1+1', '+cmd', '-1', '@SUM(A1)', '\t=1', '\r=1', '\n=1', '   =1', '\ufeff@cmd', '\u200b=cmd', '\u0000+cmd', '\tname']) assert.ok(csvCell(value).startsWith('"\''), JSON.stringify(value))
  assert.equal(csvCell('Безопасное имя'), '"Безопасное имя"')
})
