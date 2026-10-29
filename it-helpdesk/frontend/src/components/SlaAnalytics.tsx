import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../api/client'
import { useSlaRefresh } from '../tickets/useSlaRefresh'
type Stats = { activeTickets: number; responseOverdue: number; resolutionOverdue: number; approaching: number; resolvedOnTime: number; resolvedBreached: number; compliancePercent: number | null; eligibleResolved: number; unknownResolved: number }
function SlaAnalytics() {
  const { token, clearSession } = useAuth()
  const navigate = useNavigate()
  const revision = useSlaRefresh()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    apiFetch('/api/admin/sla/stats', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) { clearSession(); navigate('/login', { replace: true }); throw new Error('Сессия истекла.') }
        if (!response.ok) throw new Error('Не удалось загрузить аналитику SLA.')
        return response.json() as Promise<Stats>
      }).then((value) => { if (!controller.signal.aborted) { setStats(value); setError('') } })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [token, revision, retry])
  return <section className="sla-analytics" aria-label="Аналитика SLA">
    <div className="sla-analytics-heading"><h2>SLA Analytics</h2><Link to="/admin/tickets?slaStatus=overdue">Просроченные заявки →</Link></div>
    {error ? <div className="activity-error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить</button></div> : !stats ? <p role="status">Загружаем SLA…</p> : <>
      <div className="sla-analytics-grid">
        <div><strong>{stats.activeTickets}</strong><span>Активных</span></div>
        <Link to="/admin/tickets?slaStatus=overdue&slaStage=response"><strong>{stats.responseOverdue}</strong><span>Просрочена реакция</span></Link>
        <Link to="/admin/tickets?slaStatus=overdue&slaStage=resolution"><strong>{stats.resolutionOverdue}</strong><span>Просрочено решение</span></Link>
        <Link to="/admin/tickets?slaStatus=approaching_deadline"><strong>{stats.approaching}</strong><span>Скоро дедлайн</span></Link>
        <div><strong>{stats.compliancePercent === null ? '—' : `${stats.compliancePercent}%`}</strong><span>Соблюдение SLA решения</span></div>
        <div><strong>{stats.resolvedOnTime} / {stats.resolvedBreached}</strong><span>Решено вовремя / с нарушением</span></div>
      </div><p>Процент рассчитан по {stats.eligibleResolved} решениям с достоверным временем. Исторически неизвестных: {stats.unknownResolved}.</p>
    </>}
  </section>
}
export default SlaAnalytics
