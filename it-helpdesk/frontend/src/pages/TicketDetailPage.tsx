import { apiFetch } from '../api/client'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import TicketActivity from '../components/TicketActivity'
import TicketSla from '../components/TicketSla'
import { formatTicketDate, priorityLabels, statusLabels, type Ticket } from '../tickets/types'

function TicketDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { token, clearSession } = useAuth()
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    apiFetch(`/api/tickets/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) throw new Error('Сессия истекла.')
        if (response.status === 404) throw new Error('Заявка не найдена.')
        if (!response.ok) throw new Error('Не удалось загрузить заявку.')
        return response.json() as Promise<Ticket>
      })
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

  async function handleDelete() {
    if (!ticket || !window.confirm(`Удалить заявку «${ticket.title}»? Это действие нельзя отменить.`)) return
    setIsDeleting(true)
    setError('')
    try {
      const response = await apiFetch(`/api/tickets/${ticket.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.status === 401) {
        clearSession()
        navigate('/login', { replace: true })
        return
      }
      if (response.status === 404) {
        setError('Заявка не найдена или уже удалена.')
        return
      }
      if (!response.ok) throw new Error('Не удалось удалить заявку. Попробуйте ещё раз.')
      navigate('/tickets', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось удалить заявку.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <main className="dashboard-content ticket-page-content">
      <div className="dashboard-heading ticket-form-heading">
        <div>
          <p className="eyebrow"><span /> ОБРАЩЕНИЕ</p>
          <h1>{ticket ? `Заявка #${ticket.id}` : 'Заявка'}</h1>
        </div>
        <Link className="back-link" to="/tickets"><span aria-hidden="true">←</span> К моим заявкам</Link>
      </div>

      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {isLoading ? <div className="ticket-list-state" role="status">Загружаем заявку…</div> : ticket ? (
        <>
          <article className="ticket-detail-panel">
          <div className="ticket-detail-title-row">
            <div><div className="card-kicker">ЗАГОЛОВОК</div><h2>{ticket.title}</h2></div>
            <span className={`ticket-badge ticket-badge--${ticket.status}`}>{statusLabels[ticket.status]}</span>
          </div>
          <div className="ticket-detail-description"><div className="card-kicker">ОПИСАНИЕ ПРОБЛЕМЫ</div><p>{ticket.description}</p></div>
          <dl className="ticket-metadata">
            <div><dt>Приоритет</dt><dd className={`priority-label priority-label--${ticket.priority}`}>{priorityLabels[ticket.priority]}</dd></div>
            <div><dt>Дата создания</dt><dd>{formatTicketDate(ticket.createdAt)}</dd></div>
            <div><dt>Дата обновления</dt><dd>{formatTicketDate(ticket.updatedAt)}</dd></div>
          </dl>
          <div className="ticket-detail-actions">
            <button className="danger-button" disabled={isDeleting} onClick={handleDelete} type="button">{isDeleting ? 'Удаляем…' : 'Удалить заявку'}</button>
          </div>
        </article>
          <TicketSla ticket={ticket} />
          <TicketActivity ticketId={ticket.id} />
        </>
      ) : !error ? <div className="ticket-list-state">Заявка не найдена.</div> : null}
    </main>
  )
}

export default TicketDetailPage
