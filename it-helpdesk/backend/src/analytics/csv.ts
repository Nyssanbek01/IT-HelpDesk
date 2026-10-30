import type { analyticsExportData } from './service.js'
import { AnalyticsLimitError } from './query.js'

export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value)
  // Neutralize formula prefixes even behind spaces, BOM, Unicode whitespace or controls.
  if (/^[\s\p{Cf}\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text) || /^[\t\r\n\u0000-\u001f]/u.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
export function analyticsCsv(data: Awaited<ReturnType<typeof analyticsExportData>>) {
  const { overview: o, trend, engineers, sla } = data
  const rows: unknown[][] = [['Раздел', 'Показатель / период / инженер', 'Значение', 'Знаменатель / образцы', 'Единица / пояснение'],
    ['Период', 'С', o.range.dateFrom], ['Период', 'По (включительно UTC)', o.range.dateTo], ['Период', 'Инженер ID', o.range.engineerId],
    ['Методика', 'Создание / распределения', null, null, o.distributionsBasis],
    ['Методика', 'Решения / исполнители', null, null, engineers.attribution.rule],
    ['Методика', 'SLA', null, null, sla.basis],
    ['Обзор', 'Создано за период', o.created], ['Обзор', 'Решено за период', o.resolved], ['Обзор', 'Активно сейчас', o.activeNow],
    ['Обзор', 'Активно на конец периода', null, null, o.activeAtPeriodEndReason],
    ['Среднее', 'Реакция', o.averageResponse.milliseconds, o.averageResponse.samples, 'мс; когорта создания'],
    ['Среднее', 'Решение', o.averageResolution.milliseconds, o.averageResolution.samples, 'мс; события решения'],
    ['Исключения', 'Решения без даты во всей системе', o.unplacedResolvedGlobal, null, 'Не относятся к определённому периоду'],
    ['Исключения', 'Некорректные интервалы решения за период во всей системе', o.excludedResolutionEvents],
    ['SLA решения', 'Процент', sla.resolution.percent, sla.resolution.denominator, '%'], ['SLA решения', 'Выполнено', sla.resolution.numerator], ['SLA решения', 'Неизвестно', sla.resolution.unknown],
    ['SLA реакции', 'Процент', sla.response.percent, sla.response.denominator, '%'], ['SLA реакции', 'Выполнено', sla.response.numerator], ['SLA реакции', 'Ожидает / неизвестно', sla.response.unknown],
    ['Атрибуция', 'Неизвестный исполнитель', engineers.attribution.unknownActor], ['Атрибуция', 'Исполнитель вне текущего списка инженеров', engineers.attribution.otherActor]]
  for (const [key, value] of Object.entries(o.statuses)) rows.push(['Текущие статусы созданных', key, value])
  for (const [key, value] of Object.entries(o.priorities)) rows.push(['Приоритеты созданных', key, value])
  for (const bucket of trend.buckets) { rows.push(['Создано', bucket.bucket, bucket.created]); rows.push(['Решено', bucket.bucket, bucket.resolved]) }
  for (const engineer of engineers.items) {
    rows.push(['Инженер: активно сейчас', engineer.name, engineer.activeAssigned], ['Инженер: решено', engineer.name, engineer.resolved], ['Инженер: среднее решение', engineer.name, engineer.averageResolutionMs, engineer.resolved, 'мс'], ['Инженер: SLA %', engineer.name, engineer.resolutionSla.percent, engineer.resolutionSla.denominator, '%'], ['Инженер: SLA выполнено', engineer.name, engineer.resolutionSla.numerator])
  }
  // Bounded export: 366 daily buckets + at most 1000 engineers; no raw ticket/PII dump.
  const csv = '\ufeff' + rows.map((row) => Array.from({ length: 5 }, (_, index) => csvCell(row[index])).join(',')).join('\r\n') + '\r\n'
  if (Buffer.byteLength(csv, 'utf8') > 5 * 1024 * 1024) throw new AnalyticsLimitError('CSV exceeds the 5 MB report limit')
  return csv
}
