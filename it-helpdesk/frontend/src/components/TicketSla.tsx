import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../api/client'
import type { Ticket } from '../tickets/types'
import { formatTicketDate } from '../tickets/types'
import { remainingLabel, slaLabels, type TicketSla as SlaData } from '../tickets/sla'

function TicketSla({ ticket, compact = false }: { ticket: Ticket; compact?: boolean }) {
  const { token, user, clearSession } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<SlaData | undefined>(ticket.sla)
  const [tick, setTick] = useState(() => performance.now())
  const [error, setError] = useState('')
  const receivedAt = useMemo(() => performance.now(), [data?.serverNow])
  useEffect(() => { setData(ticket.sla); setError('') }, [ticket.sla, ticket.id])
  useEffect(() => {
    if (ticket.status === 'resolved') return
    const controller = new AbortController()
    let busy = false
    const timer = window.setInterval(async () => {
      setTick(performance.now())
      if (compact || busy || controller.signal.aborted) return
      busy = true
      try {
        const prefix = user?.role === 'admin' ? '/admin' : user?.role === 'engineer' ? '/engineer' : ''
        const response = await apiFetch(`/api${prefix}/tickets/${ticket.id}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        if (response.status === 401) { clearSession(); navigate('/login', { replace: true }); return }
        if (response.status === 403 || response.status === 404) {
          setData(undefined); setError('Заявка удалена или больше недоступна.'); window.clearInterval(timer); return
        }
        if (!response.ok) throw new Error('Не удалось обновить SLA. Показаны последние данные сервера.')
        const current = await response.json() as Ticket
        if (!controller.signal.aborted) { setData(current.sla); setError('') }
        if (current.status === 'resolved') window.clearInterval(timer)
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось обновить SLA.') }
      finally { busy = false }
    }, 60_000)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [ticket.id, ticket.status, compact, token, user?.role])
  const elapsed = Math.max(0, tick - receivedAt)
  const stages = (['response', 'resolution'] as const).map((stage) => {
    const value = data?.[stage]
    const status = value?.status ?? 'unknown'
    return <span className={`sla-stage sla-stage--${status}`} key={stage}>
      <strong>{stage === 'response' ? 'Реакция' : 'Решение'}: {slaLabels[status]}</strong>
      {value?.dueAt && <span>До {formatTicketDate(value.dueAt)}</span>}
      {value?.remainingMs !== null && value?.remainingMs !== undefined && <span className="sla-countdown">{remainingLabel(value.remainingMs - elapsed)}</span>}
      {value?.completedAt && <span>Факт: {formatTicketDate(value.completedAt)}</span>}
      {status === 'unknown' && <span>Время события не подтверждено</span>}
    </span>
  })
  if (compact) return <span className="sla-compact" aria-label="SLA заявки">{stages}</span>
  return <section className="sla-panel" aria-label="Сроки SLA">
    <h2>Сроки SLA</h2><p>Календарное время 24/7. Реакция — первое взятие инженером.</p>
    <div className="sla-stages">{stages}</div>
    {data && <small>Статус по данным сервера: {formatTicketDate(data.serverNow)}</small>}
    {error && <p className="sla-refresh-error" role="status">{error}</p>}
  </section>
}
export default TicketSla
