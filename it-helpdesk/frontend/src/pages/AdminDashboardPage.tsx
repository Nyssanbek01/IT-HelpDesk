import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { AdminStats } from '../admin/types'
import SlaAnalytics from '../components/SlaAnalytics'

function AdminDashboardPage() {
  const navigate = useNavigate()
  const { token, clearSession } = useAuth()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) throw new Error('Сессия истекла.')
        if (response.status === 403) throw new Error('Недостаточно прав для Admin Panel.')
        if (!response.ok) throw new Error('Не удалось загрузить статистику.')
        return response.json() as Promise<AdminStats>
      })
      .then(setStats)
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
  }, [token])

  const cards = [
    { title: 'Все заявки', value: stats?.totalTickets, caption: 'Всего в системе', tone: 'total' },
    { title: 'Новые', value: stats?.newTickets, caption: 'Ожидают обработки', tone: 'progress' },
    { title: 'Активные', value: stats?.inProgressTickets, caption: 'В работе', tone: 'assigned' },
    { title: 'Решённые', value: stats?.resolvedTickets, caption: 'Завершённые заявки', tone: 'resolved' },
    { title: 'Пользователи', value: stats?.totalUsers, caption: 'Все учётные записи', tone: 'total' },
    { title: 'Инженеры', value: stats?.engineers, caption: 'Команда поддержки', tone: 'assigned' },
    { title: 'Без инженера', value: stats?.unassignedTickets, caption: 'Требуют назначения', tone: 'progress' },
  ]

  return (
    <main className="dashboard-content admin-content">
      <div className="dashboard-heading">
        <div><p className="eyebrow"><span /> УПРАВЛЕНИЕ СИСТЕМОЙ</p><h1>Admin Panel</h1><p className="dashboard-welcome">Обзор пользователей и обращений IT HelpDesk</p></div>
      </div>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      <div className="stats-grid admin-stats-grid" aria-label="Статистика системы">
        {cards.map((card, index) => (
          <article className={`stat-card stat-card--${card.tone}`} key={card.title}>
            <div className="stat-card-top"><span>{card.title}</span><span className={`stat-icon stat-icon--${card.tone}`} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></div>
            <div className="stat-value">{isLoading ? '—' : card.value}</div>
            <div className="stat-caption">{card.caption}</div>
          </article>
        ))}
      </div>
      <SlaAnalytics />
      {!isLoading && !error && (
        <section className="admin-quick-links">
          <Link to="/admin/analytics">Отчёты и аналитика <span aria-hidden="true">→</span></Link>
          <Link to="/admin/tickets">Открыть все заявки <span aria-hidden="true">→</span></Link>
          <Link to="/admin/users">Управление пользователями <span aria-hidden="true">→</span></Link>
        </section>
      )}
    </main>
  )
}

export default AdminDashboardPage
