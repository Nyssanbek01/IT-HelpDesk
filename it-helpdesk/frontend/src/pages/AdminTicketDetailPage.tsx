import { apiFetch } from '../api/client'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import TicketActivity from '../components/TicketActivity'
import TicketSla from '../components/TicketSla'
import type { AdminEngineer, AdminTicket } from '../admin/types'
import { formatTicketDate, priorityLabels, statusLabels } from '../tickets/types'

function AdminTicketDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { token, clearSession } = useAuth()
  const [ticket, setTicket] = useState<AdminTicket | null>(null)
  const [engineers, setEngineers] = useState<AdminEngineer[]>([])
  const [selectedEngineer, setSelectedEngineer] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [activityRefreshKey, setActivityRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      apiFetch(`/api/admin/tickets/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
      apiFetch('/api/admin/engineers', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }),
    ])
      .then(async ([ticketResponse, engineerResponse]) => {
        if (ticketResponse.status === 401 || engineerResponse.status === 401) throw new Error('Сессия истекла.')
        if (ticketResponse.status === 403 || engineerResponse.status === 403) throw new Error('Недостаточно прав для Admin Panel.')
        if (ticketResponse.status === 404) throw new Error('Заявка не найдена.')
        if (!ticketResponse.ok || !engineerResponse.ok) throw new Error('Не удалось загрузить данные заявки.')
        return Promise.all([ticketResponse.json() as Promise<AdminTicket>, engineerResponse.json() as Promise<AdminEngineer[]>])
      })
      .then(([loadedTicket, loadedEngineers]) => {
        setTicket(loadedTicket)
        setSelectedEngineer(loadedTicket.assignedEngineerId === null ? '' : String(loadedTicket.assignedEngineerId))
        setEngineers(loadedEngineers)
      })
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

  async function saveAssignment() {
    if (!ticket) return
    setIsSaving(true)
    setError('')
    setSuccess('')
    try {
      const response = await apiFetch(`/api/admin/tickets/${ticket.id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ engineerId: selectedEngineer ? Number(selectedEngineer) : null }),
      })
      const body = await response.json() as AdminTicket & { message?: string }
      if (response.status === 401) {
        clearSession()
        navigate('/login', { replace: true })
        return
      }
      if (!response.ok) {
        setError(body.message ?? 'Не удалось изменить назначение.')
        return
      }
      setTicket(body)
      setSelectedEngineer(body.assignedEngineerId === null ? '' : String(body.assignedEngineerId))
      setActivityRefreshKey((value) => value + 1)
      setSuccess(body.assignedEngineer ? `Заявка назначена инженеру ${body.assignedEngineer.name}.` : 'Назначение снято.')
    } catch {
      setError('Сервер недоступен. Попробуйте ещё раз.')
    } finally {
      setIsSaving(false)
    }
  }

  const assignmentChanged = ticket && selectedEngineer !== (ticket.assignedEngineerId === null ? '' : String(ticket.assignedEngineerId))

  return (
    <main className="dashboard-content admin-content">
      <div className="dashboard-heading admin-page-heading"><div><p className="eyebrow"><span /> ADMIN PANEL</p><h1>{ticket ? `Заявка #${ticket.id}` : 'Детали заявки'}</h1><p className="dashboard-welcome">Полная информация и управление назначением</p></div><Link className="back-link" to="/admin/tickets"><span aria-hidden="true">←</span> Ко всем заявкам</Link></div>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {success && <div className="notice notice--success" role="status">{success}</div>}
      {isLoading ? <div className="ticket-list-state" role="status">Загружаем заявку…</div> : ticket ? (
        <>
          <article className="ticket-detail-panel admin-ticket-detail">
            <div className="ticket-detail-title-row"><div><div className="card-kicker">ЗАГОЛОВОК</div><h2>{ticket.title}</h2></div><span className={`ticket-badge ticket-badge--${ticket.status}`}>{statusLabels[ticket.status]}</span></div>
            <div className="ticket-detail-description"><div className="card-kicker">ОПИСАНИЕ ПРОБЛЕМЫ</div><p>{ticket.description}</p></div>
            <dl className="ticket-metadata engineer-ticket-metadata">
              <div><dt>Автор</dt><dd>{ticket.user.name}</dd></div><div><dt>Email автора</dt><dd>{ticket.user.email}</dd></div>
              <div><dt>Статус</dt><dd>{statusLabels[ticket.status]}</dd></div><div><dt>Приоритет</dt><dd className={`priority-label priority-label--${ticket.priority}`}>{priorityLabels[ticket.priority]}</dd></div>
              <div><dt>Дата создания</dt><dd>{formatTicketDate(ticket.createdAt)}</dd></div><div><dt>Дата обновления</dt><dd>{formatTicketDate(ticket.updatedAt)}</dd></div>
            </dl>
            <div className="admin-assignment-form">
              <label className="field-label" htmlFor="admin-engineer-select">Назначенный инженер</label>
              <div className="admin-assignment-controls">
                <select className="text-input admin-engineer-select" id="admin-engineer-select" onChange={(event) => setSelectedEngineer(event.target.value)} value={selectedEngineer}>
                  <option value="">Не назначен</option>
                  {engineers.map((engineer) => <option key={engineer.id} value={engineer.id}>{engineer.name} · {engineer.email} · {engineer.openAssignedTickets} активных</option>)}
                </select>
                <button className="primary-button create-ticket-button" disabled={isSaving || !assignmentChanged} onClick={saveAssignment} type="button">{isSaving ? 'Сохраняем…' : selectedEngineer ? 'Назначить' : 'Снять назначение'}</button>
              </div>
            </div>
          </article>
          <TicketSla ticket={ticket} />
          <TicketActivity ticketId={ticket.id} refreshKey={activityRefreshKey} />
        </>
      ) : !error ? <div className="ticket-list-state">Заявка не найдена.</div> : null}
    </main>
  )
}

export default AdminTicketDetailPage
