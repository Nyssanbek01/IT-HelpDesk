import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch, notificationsChangedEvent } from '../api/client'
import { formatTicketDate } from '../tickets/types'

type Notification = {
  id: number; type: string | null; title: string; message: string
  ticketId: number | null; ticketAvailable: boolean
  isRead: boolean; createdAt: string; readAt: string | null
}
type NotificationPage = { items: Notification[]; totalPages: number }

function NotificationBell() {
  const { token, user, clearSession } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const firstControl = useRef<HTMLButtonElement>(null)
  const openRef = useRef(open)
  const pageRef = useRef(page)
  openRef.current = open
  pageRef.current = page
  const refresh = useRef<(command?: string) => void>(() => {})
  const navigateNotification = useRef<(item: Notification) => Promise<void>>(async () => {})

  useEffect(() => {
    if (!token || !user) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false
    let dirty = false
    const commands: Array<string | Notification> = []
    const role = user.role
    const headers = { Authorization: `Bearer ${token}` }
    async function request(path: string, method = 'GET') {
      const response = await apiFetch(path, { method, headers, signal: controller.signal })
      if (response.status === 401) {
        controller.abort()
        clearTimeout(timer)
        clearSession()
        navigate('/login', { replace: true })
        throw new Error('Сессия истекла.')
      }
      return response
    }
    async function visit(item: Notification) {
      if (!item.ticketAvailable || item.ticketId === null) {
        setNotice('Заявка удалена или у вас больше нет доступа.'); return
      }
      const path = role === 'admin' ? `/admin/tickets/${item.ticketId}` : role === 'engineer' ? `/engineer/tickets/${item.ticketId}` : `/tickets/${item.ticketId}`
      const response = await request(`/api${path}`)
      if (response.status === 403 || response.status === 404) {
        setNotice('Заявка удалена или у вас больше нет доступа.'); return
      }
      if (!response.ok) throw new Error('Не удалось открыть заявку. Попробуйте ещё раз.')
      setOpen(false)
      navigate(path)
    }
    async function run() {
      clearTimeout(timer)
      if (running) { dirty = true; return }
      if (controller.signal.aborted) return
      running = true
      setLoading(true)
      setError('')
      try {
        do {
          dirty = false
          while (commands.length && !controller.signal.aborted) {
            const command = commands.shift()!
            setWorking(true)
            if (typeof command !== 'string') await visit(command)
            else {
              const response = await request(command, 'PATCH')
              if (!response.ok) throw new Error('Не удалось отметить уведомление прочитанным.')
            }
          }
          const countResponse = await request('/api/notifications/unread-count')
          if (!countResponse.ok) throw new Error('Не удалось обновить уведомления.')
          const body = await countResponse.json() as { count: number }
          if (controller.signal.aborted) return
          setCount(body.count)
          if (openRef.current) {
            const listResponse = await request(`/api/notifications?page=${pageRef.current}&limit=10`)
            if (!listResponse.ok) throw new Error('Не удалось загрузить уведомления.')
            const list = await listResponse.json() as NotificationPage
            if (controller.signal.aborted) return
            setItems(list.items)
            setTotalPages(list.totalPages)
            if (list.totalPages > 0 && pageRef.current > list.totalPages) { pageRef.current = list.totalPages; setPage(list.totalPages); dirty = true }
          }
        } while ((dirty || commands.length) && !controller.signal.aborted)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Сервер недоступен.')
      } finally {
        running = false
        if (!controller.signal.aborted) {
          setLoading(false)
          setWorking(false)
          if (commands.length || dirty) void run()
          else timer = setTimeout(() => { void run() }, 30_000)
        }
      }
    }
    refresh.current = (command) => {
      if (command) { commands.push(command); setWorking(true) }
      void run()
    }
    navigateNotification.current = async (item) => { commands.push(item); setWorking(true); await run() }
    const changed = () => { void run() }
    window.addEventListener(notificationsChangedEvent, changed)
    void run()
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener(notificationsChangedEvent, changed)
      refresh.current = () => {}
      navigateNotification.current = async () => {}
    }
  }, [token, user?.id, user?.role])

  useEffect(() => {
    if (!open) return
    setNotice('')
    refresh.current()
    firstControl.current?.focus()
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', keyboard) }
  }, [open])

  useEffect(() => { if (openRef.current) refresh.current() }, [page])

  return (
    <div className="notification-bell" ref={root}>
      <button ref={trigger} className="notification-trigger" type="button" aria-label={`Уведомления: ${count} непрочитанных`} aria-expanded={open} aria-controls="notification-dropdown" onClick={() => { setOpen((value) => !value); setPage(1) }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
        {count > 0 && <span className="notification-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
        {!open && error && <span className="notification-error-dot" aria-hidden="true" />}
      </button>
      {open && (
        <section className="notification-dropdown" id="notification-dropdown" aria-label="Уведомления" aria-busy={loading}>
          <div className="notification-heading"><h2>Уведомления</h2><button ref={firstControl} type="button" aria-label="Закрыть уведомления" onClick={() => { setOpen(false); trigger.current?.focus() }}>×</button></div>
          <div className="notification-toolbar"><span>{count} непрочитанных</span><button type="button" disabled={working || count === 0} onClick={() => refresh.current('/api/notifications/read-all')}>Прочитать все</button></div>
          {error && <div className="activity-error" role="alert">{error}<button type="button" onClick={() => refresh.current()}>Повторить</button></div>}
          {notice && <div className="notification-notice" role="status">{notice}</div>}
          {loading && <div className="notification-state" role="status">Обновляем уведомления…</div>}
          {!loading && !error && items.length === 0 && <div className="notification-state">Уведомлений пока нет.</div>}
          {!error && <ul className="notification-list">{items.map((item) => (
            <li className={`notification-item${item.isRead ? '' : ' notification-item--unread'}`} key={item.id}>
              <button className="notification-link" type="button" disabled={working} onClick={() => { setNotice(''); void navigateNotification.current(item) }}><strong>{item.title}</strong><span>{item.message}</span></button>
              <div className="notification-item-footer"><time dateTime={item.createdAt}>{formatTicketDate(item.createdAt)}</time>{!item.isRead && <button type="button" disabled={working} onClick={() => refresh.current(`/api/notifications/${item.id}/read`)}>Отметить прочитанным</button>}</div>
            </li>
          ))}</ul>}
          {totalPages > 1 && <div className="notification-pagination"><button type="button" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Назад</button><span>{page} / {totalPages}</span><button type="button" disabled={loading || page >= totalPages} onClick={() => setPage((value) => value + 1)}>Далее</button></div>}
        </section>
      )}
    </div>
  )
}

export default NotificationBell
