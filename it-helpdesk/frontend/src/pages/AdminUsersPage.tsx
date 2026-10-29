import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { adminRoleLabels, type AdminUser, type PaginatedResult } from '../admin/types'
import { formatTicketDate } from '../tickets/types'

const pageSize = 20

function AdminUsersPage() {
  const navigate = useNavigate()
  const { token, user: currentUser, clearSession } = useAuth()
  const [result, setResult] = useState<PaginatedResult<AdminUser> | null>(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('all')
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), role })
    if (search) query.set('search', search)
    setIsLoading(true)
    setError('')
    fetch(`/api/admin/users?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) throw new Error('Сессия истекла.')
        if (response.status === 403) throw new Error('Недостаточно прав для управления пользователями.')
        if (!response.ok) throw new Error('Не удалось загрузить пользователей.')
        return response.json() as Promise<PaginatedResult<AdminUser>>
      })
      .then(setResult)
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
  }, [token, search, role, page])

  async function changeRole(target: AdminUser, nextRole: AdminUser['role']) {
    if (nextRole === target.role) return
    if (!window.confirm(`Изменить роль пользователя ${target.name} на «${adminRoleLabels[nextRole]}»?`)) return
    setError('')
    setSuccess('')
    setUpdatingId(target.id)
    try {
      const response = await fetch(`/api/admin/users/${target.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: nextRole }),
      })
      const body = await response.json() as AdminUser & { message?: string }
      if (response.status === 401) {
        clearSession()
        navigate('/login', { replace: true })
        return
      }
      if (!response.ok) {
        setError(body.message ?? 'Не удалось изменить роль пользователя.')
        return
      }
      setResult((current) => current ? { ...current, items: current.items.map((item) => item.id === body.id ? body : item) } : current)
      setSuccess(`Роль пользователя ${body.name} изменена.`)
    } catch {
      setError('Сервер недоступен. Попробуйте ещё раз.')
    } finally {
      setUpdatingId(null)
    }
  }

  function applySearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setSearch(searchDraft.trim())
  }

  return (
    <main className="dashboard-content admin-content">
      <div className="dashboard-heading admin-page-heading"><div><p className="eyebrow"><span /> ADMIN PANEL</p><h1>Пользователи</h1><p className="dashboard-welcome">Управление учётными записями и ролями</p></div><span className="admin-total">{result?.total ?? '—'} пользователей</span></div>
      <section className="admin-toolbar">
        <form className="admin-search" onSubmit={applySearch}><input aria-label="Поиск пользователей" className="text-input" maxLength={100} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Имя или email" value={searchDraft} /><button className="secondary-button" type="submit">Найти</button></form>
        <label className="admin-filter-label">Роль<select className="admin-filter-select" onChange={(event) => { setPage(1); setRole(event.target.value) }} value={role}><option value="all">Все роли</option><option value="user">Пользователь</option><option value="engineer">Инженер</option><option value="admin">Администратор</option></select></label>
      </section>
      {error && <div className="notice notice--error" role="alert">{error}</div>}
      {success && <div className="notice notice--success" role="status">{success}</div>}
      {isLoading ? <div className="ticket-list-state" role="status">Загружаем пользователей…</div> : error ? null : !result?.items.length ? <div className="ticket-list-state">Пользователи не найдены.</div> : (
        <section className="ticket-table-wrap admin-table-wrap" aria-label="Пользователи">
          <div className="ticket-table admin-user-table admin-table--head" aria-hidden="true"><span>Имя</span><span>Email</span><span>Роль</span><span>Дата регистрации</span></div>
          <div className="ticket-table-body">{result.items.map((item) => (
            <div className="ticket-table admin-user-table admin-table--row" key={item.id}>
              <span className="admin-user-name">{item.name}</span><span className="admin-user-email">{item.email}</span>
              <span><select aria-label={`Роль пользователя ${item.name}`} className="role-select" disabled={updatingId === item.id || (item.id === currentUser?.id && currentUser.role === 'admin')} onChange={(event) => changeRole(item, event.target.value as AdminUser['role'])} value={item.role}><option value="user">Пользователь</option><option value="engineer">Инженер</option><option value="admin">Администратор</option></select></span>
              <span className="ticket-date">{formatTicketDate(item.createdAt)}</span>
            </div>
          ))}</div>
        </section>
      )}
      <div className="admin-pagination"><span>{result ? `${result.total} записей · страница ${result.page} из ${Math.max(result.totalPages, 1)}` : ''}</span><div><button className="secondary-button" disabled={page <= 1 || isLoading} onClick={() => setPage((value) => value - 1)} type="button">Назад</button><button className="secondary-button" disabled={isLoading || !result || page >= result.totalPages} onClick={() => setPage((value) => value + 1)} type="button">Далее</button></div></div>
    </main>
  )
}

export default AdminUsersPage
