import { apiFetch } from '../api/client'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import TicketActivity from '../components/TicketActivity'
import TicketSla from '../components/TicketSla'
import { formatTicketDate, priorityLabels, statusLabels, type EngineerTicket } from '../tickets/types'

function EngineerTicketPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { token, user, clearSession } = useAuth()
  const [ticket, setTicket] = useState<EngineerTicket | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState('')
  const [activityRefreshKey, setActivityRefreshKey] = useState(0)

  async function loadTicket(signal?: AbortSignal) {
    const response = await apiFetch(`/api/engineer/tickets/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
    if (response.status === 401) throw new Error('Сессия истекла.')
    if (response.status === 403) throw new Error('Недостаточно прав для просмотра заявки.')
    if (response.status === 404) throw new Error('Заявка не найдена.')
    if (!response.ok) throw new Error('Не удалось загрузить заявку.')
    return response.json() as Promise<EngineerTicket>
  }

  useEffect(() => {
    const controller = new AbortController()
    loadTicket(controller.signal)
      .then(setTicket)
      .catch((reason: Error) => {
        if (reason.name === 'AbortError') return
        if (reason.message === 'Сессия истекла.') {
          clearSession()
          navigate('/login', { replace: true })
          return
        }
        setError(reason.message)
      })
      .finally(() => setIsLoading(false))
    return () => controller.abort()
  }, [id, token])

  async function updateStatus(action: 'take' | 'resolve') {
    if (!ticket) return
    setError('')
    setIsWorking(true)
    try {
      const response = await apiFetch(`/api/engineer/tickets/${ticket.id}/${action}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await response.json() as EngineerTicket & { message?: string }
      if (response.status === 401) {
        clearSession()
        navigate('/login', { replace: true })
        return
      }
      if (!response.ok) {
        setError(response.status === 409 ? 'Заявку уже взял другой инженер. Обновите список.' : body.message ?? 'Не удалось обновить заявку.')
        return
      }
      setTicket(body)
      setActivityRefreshKey((value) => value + 1)
    } catch {
      setError('Сервер недоступен. Попробуйте ещё раз.')
    } finally {
      setIsWorking(false)
    }
  }

  const canTake = ticket?.status === 'new' && (ticket.assignedEngineerId === null || ticket.assignedEngineerId === user?.id)
  const canResolve = ticket?.status === 'in_progress' && ticket.assignedEngineerId === user?.id

  return (
    <main className="dashboard-content engineer-content">
      <div className="dashboard-heading engineer-detail-heading">
        <div>
          <p className="eyebrow"><span /> ОБРАЩЕНИЕ</p>
          <h1>{ticket ? `Заявка #${ticket.id}` : 'Заявка'}</h1>
        </div>
        <Link className="back-link" to="/engineer"><span aria-hidden="true">←</span> Ко всем заявкам</Link>
      </div>

      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {isLoading ? (
        <div className="ticket-list-state" role="status">Загружаем заявку…</div>
      ) : ticket ? (
        <>
          <article className="ticket-detail-panel engineer-ticket-detail">
          <div className="ticket-detail-title-row">
            <div><div className="card-kicker">ЗАГОЛОВОК</div><h2>{ticket.title}</h2></div>
            <span className={`ticket-badge ticket-badge--${ticket.status}`}>{statusLabels[ticket.status]}</span>
          </div>
          <div className="ticket-detail-description"><div className="card-kicker">ОПИСАНИЕ ПРОБЛЕМЫ</div><p>{ticket.description}</p></div>
          <dl className="ticket-metadata engineer-ticket-metadata">
            <div><dt>Автор</dt><dd>{ticket.user.name}</dd></div>
            <div><dt>Email автора</dt><dd>{ticket.user.email}</dd></div>
            <div><dt>Приоритет</dt><dd className={`priority-label priority-label--${ticket.priority}`}>{priorityLabels[ticket.priority]}</dd></div>
            <div><dt>Назначенный инженер</dt><dd>{ticket.assignedEngineer?.name ?? 'Не назначен'}</dd></div>
            <div><dt>Дата создания</dt><dd>{formatTicketDate(ticket.createdAt)}</dd></div>
            <div><dt>Дата обновления</dt><dd>{formatTicketDate(ticket.updatedAt)}</dd></div>
          </dl>
          {(canTake || canResolve) && (
            <div className="ticket-detail-actions">
              {canTake && <button className="primary-button create-ticket-button" disabled={isWorking} onClick={() => updateStatus('take')} type="button">{isWorking ? 'Назначаем…' : 'Взять в работу'}</button>}
              {canResolve && <button className="primary-button create-ticket-button" disabled={isWorking} onClick={() => updateStatus('resolve')} type="button">{isWorking ? 'Завершаем…' : 'Завершить заявку'}</button>}
            </div>
          )}
        </article>
          <TicketSla ticket={ticket} />
          <TicketActivity ticketId={ticket.id} refreshKey={activityRefreshKey} />
        </>
      ) : !error ? <div className="ticket-list-state">Заявка не найдена.</div> : null}
    </main>
  )
}

export default EngineerTicketPage
