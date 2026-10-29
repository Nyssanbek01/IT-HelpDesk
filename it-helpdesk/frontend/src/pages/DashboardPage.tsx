import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { Ticket } from '../tickets/types'
import type { TicketListResult } from '../tickets/useTicketList'
import TicketSla from '../components/TicketSla'
import { useSlaRefresh } from '../tickets/useSlaRefresh'

function DashboardPage() {
  const navigate = useNavigate()
  const revision = useSlaRefresh()
  const { token, user, clearSession } = useAuth()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [summary, setSummary] = useState<TicketListResult['summary'] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/tickets', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 401 ? 'Сессия истекла.' : 'Не удалось загрузить заявки.')
        return response.json() as Promise<TicketListResult>
      })
      .then((result) => { setTickets(result.items); setSummary(result.summary) })
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
  }, [token, revision])

  const inProgress = summary?.in_progress ?? 0
  const resolved = summary?.resolved ?? 0

  return (
    <main className="dashboard-content">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow"><span /> ОБЗОР</p>
          <h1>IT HelpDesk</h1>
          <p className="dashboard-welcome">Добро пожаловать, {user?.name}</p>
        </div>
        <Link className="primary-button create-ticket-button" to="/tickets/new"><span aria-hidden="true">＋</span> Создать заявку</Link>
      </div>

      {error && <div className="notice notice--error" role="alert">{error}</div>}
      <div className="stats-grid" aria-label="Сводка по заявкам">
        <article className="stat-card stat-card--total"><div className="stat-card-top"><span>Мои заявки</span><span className="stat-icon stat-icon--total" aria-hidden="true">01</span></div><div className="stat-value">{isLoading ? '—' : summary?.total ?? 0}</div><div className="stat-caption">Все ваши обращения</div></article>
        <article className="stat-card stat-card--progress"><div className="stat-card-top"><span>В работе</span><span className="stat-icon stat-icon--progress" aria-hidden="true">02</span></div><div className="stat-value">{isLoading ? '—' : inProgress}</div><div className="stat-caption">Сейчас решаются</div></article>
        <article className="stat-card stat-card--resolved"><div className="stat-card-top"><span>Решено</span><span className="stat-icon stat-icon--resolved" aria-hidden="true">03</span></div><div className="stat-value">{isLoading ? '—' : resolved}</div><div className="stat-caption">Успешно завершены</div></article>
      </div>

      <div className="sla-overview-grid">{tickets.filter((ticket) => ticket.status !== 'resolved').slice(0, 3).map((ticket) => <Link key={ticket.id} to={`/tickets/${ticket.id}`}><strong>#{ticket.id} · {ticket.title}</strong><TicketSla ticket={ticket} compact /></Link>)}</div>
      <section className="empty-state" aria-labelledby="empty-title">
        <div className="empty-illustration" aria-hidden="true"><span className="empty-sheet" /><span className="empty-spark empty-spark--one" /><span className="empty-spark empty-spark--two" /></div>
        <p className="card-kicker">{isLoading ? 'ЗАГРУЗКА' : tickets.length ? 'ОБРАЩЕНИЯ' : 'ВСЁ СПОКОЙНО'}</p>
        <h2 id="empty-title">{isLoading ? 'Загружаем заявки…' : tickets.length ? 'Заявки готовы к работе' : 'Пока нет активных заявок'}</h2>
        <p>{isLoading ? 'Получаем данные из рабочего пространства.' : tickets.length ? <Link to="/tickets">Перейти к моим заявкам</Link> : 'Когда появятся обращения, здесь будет их краткий обзор.'}</p>
      </section>
    </main>
  )
}

export default DashboardPage
