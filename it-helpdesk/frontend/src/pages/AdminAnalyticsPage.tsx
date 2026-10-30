import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../api/client'
import AnalyticsChart from '../components/AnalyticsChart'
import { analyticsDuration, type AnalyticsOverview, type AnalyticsTrend, type AnalyticsEngineers, type AnalyticsSla, type AnalyticsRange } from '../admin/analytics'
import { priorityLabels, statusLabels } from '../tickets/types'

type Report = { overview: AnalyticsOverview; trend: AnalyticsTrend; engineers: AnalyticsEngineers; sla: AnalyticsSla }
const green = '#285d49', gold = '#c98a32'
const dataset = (label: string, data: number[], color = green) => ({ label, data, borderColor: color, backgroundColor: color })

export default function AdminAnalyticsPage() {
  const { token, clearSession } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = params.toString(), key = `${token}:${query}`
  const [state, setState] = useState<{ key: string; data?: Report; error?: string }>({ key: '' })
  const [defaults, setDefaults] = useState<AnalyticsRange | null>(null)
  const [engineers, setEngineers] = useState<Array<{ id: number; name: string }>>([])
  const [retry, setRetry] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const exportController = useRef<AbortController | null>(null)
  const data = state.key === key ? state.data : undefined
  const error = state.key === key ? state.error : undefined

  useEffect(() => {
    const controller = new AbortController()
    exportController.current?.abort(); exportController.current = null; setExporting(false); setExportMessage('')
    setState({ key })
    const load = async <T,>(name: string): Promise<T> => {
      const response = await apiFetch(`/api/admin/analytics/${name}?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      if (response.status === 401) { clearSession(); navigate('/login', { replace: true }); throw new Error('Сессия истекла.') }
      if (response.status === 403) throw new Error('Аналитика доступна только администратору.')
      if (response.status === 400) throw new Error('Проверьте ISO-даты, период до 366 дней и выбранного инженера.')
      if (!response.ok) throw new Error('Не удалось загрузить отчёт. Попробуйте ещё раз.')
      return response.json() as Promise<T>
    }
    Promise.all([load<AnalyticsOverview>('overview'), load<AnalyticsTrend>('tickets-trend'), load<AnalyticsEngineers>('engineers'), load<AnalyticsSla>('sla')])
      .then(([overview, trend, team, sla]) => {
        if (controller.signal.aborted) return
        setState({ key, data: { overview, trend, engineers: team, sla } }); setDefaults(overview.range); setEngineers(team.options)
      }).catch((reason: Error) => { if (!controller.signal.aborted) { controller.abort(); setState({ key, error: reason.message }) } })
    return () => { controller.abort(); exportController.current?.abort() }
  }, [key, query, token, retry])

  function update(name: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (defaults && (name === 'dateFrom' || name === 'dateTo')) { if (!next.has('dateFrom')) next.set('dateFrom', defaults.dateFrom); if (!next.has('dateTo')) next.set('dateTo', defaults.dateTo) }
      if (value) next.set(name, value); else next.delete(name)
      return next
    })
  }
  async function exportCsv() {
    if (exportController.current && !exportController.current.signal.aborted) return
    const controller = new AbortController(); exportController.current = controller; setExporting(true); setExportMessage('')
    try {
      const response = await apiFetch(`/api/admin/analytics/export?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      if (response.status === 401) { clearSession(); navigate('/login', { replace: true }); return }
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/csv')) throw new Error('Не удалось выгрузить CSV. Проверьте период и повторите попытку.')
      const blob = await response.blob()
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = `helpdesk-analytics-${data?.overview.range.dateFrom ?? 'report'}.csv`; document.body.append(link)
      try { link.click() } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setExportMessage('CSV передан браузеру для скачивания.')
    } catch (reason) { if (!controller.signal.aborted) setExportMessage(reason instanceof Error ? reason.message : 'Ошибка выгрузки.') }
    finally { if (exportController.current === controller) { exportController.current = null; setExporting(false) } }
  }
  const overview = data?.overview
  const cards = overview ? [
    ['Создано за период', overview.created, 'По дате создания'], ['Решено за период', overview.resolved, 'По достоверному resolvedAt'], ['Активно сейчас', overview.activeNow, 'Текущая нагрузка, не исторический срез'],
    ['Активно на конец периода', 'Недоступно', overview.activeAtPeriodEndReason],
    ['Средняя реакция', analyticsDuration(overview.averageResponse.milliseconds), `${overview.averageResponse.samples} достоверных образцов; когорта создания`],
    ['Среднее решение', analyticsDuration(overview.averageResolution.milliseconds), `${overview.averageResolution.samples} достоверных решений за период`],
    ['SLA решения', overview.resolutionSla.percent === null ? 'Нет достоверных данных' : `${overview.resolutionSla.percent}%`, `${overview.resolutionSla.numerator} / ${overview.resolutionSla.denominator}; неизвестно: ${overview.resolutionSla.unknown}`],
  ] : []
  const statusKeys = overview ? [...new Set(['new', 'in_progress', 'resolved', ...Object.keys(overview.statuses)])] : []
  const priorityKeys = overview ? [...new Set(['low', 'medium', 'high', ...Object.keys(overview.priorities)])] : []
  return <main className="dashboard-content admin-content analytics-content">
    <div className="dashboard-heading admin-page-heading"><div><p className="eyebrow"><span /> REPORTS & ANALYTICS</p><h1>Аналитика</h1><p className="dashboard-welcome">Фактические показатели PostgreSQL · периоды в UTC</p></div><button className="secondary-button" type="button" disabled={exporting || !data} onClick={exportCsv}>{exporting ? 'Выгружаем…' : 'Экспорт CSV'}</button></div>
    <section className="analytics-filters" aria-label="Фильтры аналитики">
      <label>Период с (UTC)<input className="text-input" aria-label="Период с" type="date" value={params.get('dateFrom') ?? defaults?.dateFrom ?? ''} onChange={(event) => update('dateFrom', event.target.value)} /></label>
      <label>По (включительно UTC)<input className="text-input" aria-label="Период по" type="date" value={params.get('dateTo') ?? defaults?.dateTo ?? ''} onChange={(event) => update('dateTo', event.target.value)} /></label>
      <label>Группировка<select className="admin-filter-select" aria-label="Группировка" value={params.get('interval') ?? 'day'} onChange={(event) => update('interval', event.target.value)}><option value="day">День</option><option value="week">Неделя (с понедельника)</option><option value="month">Месяц</option></select></label>
      <label>Инженер<select className="admin-filter-select" aria-label="Инженер аналитики" value={params.get('engineerId') ?? ''} onChange={(event) => update('engineerId', event.target.value)}><option value="">Все</option>{engineers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="secondary-button" type="button" onClick={() => setParams({})}>Сбросить период</button>
    </section>
    {exportMessage && <p className="notice" role="status">{exportMessage}</p>}
    {error ? <div className="activity-error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить</button></div> : !data ? <div className="ticket-list-state" role="status">Загружаем аналитику…</div> : <>
      {data.overview.created === 0 && data.overview.resolved === 0 && <p className="notice" role="status">За период нет подтверждённых созданий и решений. Текущая нагрузка показана отдельно.</p>}
      <div className="analytics-metrics">{cards.map(([label, value, caption]) => <article className="stat-card stat-card--total" key={label}><div className="stat-card-top"><span>{label}</span></div><div className="analytics-metric-value">{value}</div><p>{caption}</p></article>)}</div>
      <p className="analytics-explanation">Создание и распределения фильтруются по текущему назначению. Решения — по достоверному исполнителю в истории. Реакция: среднее по созданным за период с подтверждённым событием до конца периода. Исторических решений без даты во всей системе: {data.overview.unplacedResolvedGlobal}; они не приписываются выбранному периоду. Во всей системе за период исключено некорректных интервалов решения: {data.overview.excludedResolutionEvents}.</p>
      <div className="analytics-charts">
        <AnalyticsChart title="Созданные и решённые заявки" type="line" labels={data.trend.buckets.map((item) => item.bucket.slice(0, 10))} datasets={[dataset('Создано', data.trend.buckets.map((item) => item.created)), dataset('Решено', data.trend.buckets.map((item) => item.resolved), gold)]} description="UTC, хронологически; нулевые интервалы сохранены. Решение — по дате resolvedAt." />
        <AnalyticsChart title="Текущие статусы созданных за период" labels={statusKeys.map((key) => statusLabels[key as keyof typeof statusLabels] ?? key)} datasets={[dataset('Заявки', statusKeys.map((key) => data.overview.statuses[key] ?? 0))]} description={data.overview.distributionsBasis} />
        <AnalyticsChart title="Приоритеты созданных за период" labels={priorityKeys.map((key) => priorityLabels[key as keyof typeof priorityLabels] ?? key)} datasets={[dataset('Заявки', priorityKeys.map((key) => data.overview.priorities[key] ?? 0), gold)]} description="Когорта по дате создания, не по дате решения." />
        <AnalyticsChart title="SLA реакции" labels={['Выполнен', 'Нарушен', 'Ожидает / неизвестно']} datasets={[dataset('Этапы', [data.sla.response.numerator, data.sla.response.denominator - data.sla.response.numerator, data.sla.response.unknown])]} description={`${data.sla.response.numerator} / ${data.sla.response.denominator} подтверждённых реакций; неизвестные не входят в процент.`} />
        <AnalyticsChart title="SLA решения" labels={['Выполнен', 'Нарушен', 'Неизвестно']} datasets={[dataset('Этапы', [data.sla.resolution.numerator, data.sla.resolution.denominator - data.sla.resolution.numerator, data.sla.resolution.unknown], gold)]} description={data.sla.basis} />
      </div>
      <section className="analytics-engineers"><h2>Инженеры и нагрузка</h2><p>Количество обращений — показатель нагрузки, а не единственная оценка эффективности.</p>
        {!data.engineers.items.length ? <p>Инженеров по выбранному фильтру нет.</p> : <table className="analytics-engineer-table"><thead><tr><th>Инженер</th><th>Активно сейчас</th><th>Решено за период</th><th>Среднее решение</th><th>SLA решения</th></tr></thead><tbody>{data.engineers.items.map((item) => <tr key={item.id}><td data-label="Инженер">{item.name}</td><td data-label="Активно сейчас">{item.activeAssigned}</td><td data-label="Решено за период">{item.resolved}</td><td data-label="Среднее решение">{analyticsDuration(item.averageResolutionMs)}</td><td data-label="SLA решения">{item.resolutionSla.percent === null ? 'Нет достоверных данных' : `${item.resolutionSla.percent}%`} ({item.resolutionSla.numerator}/{item.resolutionSla.denominator})</td></tr>)}</tbody></table>}
        <p>{data.engineers.attribution.rule}</p><p>Неизвестный исполнитель: {data.engineers.attribution.unknownActor}. Исполнители вне текущего списка инженеров: {data.engineers.attribution.otherActor}.</p>
      </section>
    </>}
  </main>
}
