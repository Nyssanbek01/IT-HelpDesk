import { apiFetch } from '../api/client'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import TicketAttachments from './TicketAttachments'
import { formatTicketDate, type TicketComment, type TicketHistoryEntry } from '../tickets/types'

type TicketActivityProps = {
  ticketId: number
  refreshKey?: number
}

const statusNames: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  resolved: 'Решена',
}

const actionNames: Record<string, string> = {
  attachment_added: 'Добавлено вложение',
  attachment_deleted: 'Удалено вложение',
  ticket_created: 'Заявка создана',
  engineer_assigned: 'Назначен инженер',
  status_changed: 'Изменён статус',
}

function historyValue(entry: TicketHistoryEntry) {
  if (entry.action === 'status_changed') {
    const oldStatus = entry.oldValue ? statusNames[entry.oldValue] ?? entry.oldValue : '—'
    const newStatus = entry.newValue ? statusNames[entry.newValue] ?? entry.newValue : '—'
    return `${oldStatus} → ${newStatus}`
  }
  if (entry.action === 'engineer_assigned') {
    return entry.newValue ? `Инженер #${entry.newValue}` : 'Инженер не назначен'
  }
  if (entry.action === 'ticket_created') {
    return entry.newValue ? `Статус: ${statusNames[entry.newValue] ?? entry.newValue}` : ''
  }
  return [entry.oldValue, entry.newValue].filter(Boolean).join(' → ')
}

function TicketActivity({ ticketId, refreshKey = 0 }: TicketActivityProps) {
  const navigate = useNavigate()
  const { token, clearSession } = useAuth()
  const [comments, setComments] = useState<TicketComment[]>([])
  const [history, setHistory] = useState<TicketHistoryEntry[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [commentsError, setCommentsError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setCommentsLoading(true)
    setHistoryLoading(true)
    setCommentsError('')
    setHistoryError('')

    const requestOptions = {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }
    const handleUnauthorized = (response: Response) => {
      if (response.status === 401) {
        clearSession()
        navigate('/login', { replace: true })
        return true
      }
      return false
    }

    apiFetch(`/api/tickets/${ticketId}/comments`, requestOptions)
      .then(async (response) => {
        if (handleUnauthorized(response)) throw new Error('Сессия истекла.')
        if (response.status === 404) throw new Error('Заявка не найдена или недоступна.')
        if (!response.ok) throw new Error('Не удалось загрузить комментарии.')
        return response.json() as Promise<TicketComment[]>
      })
      .then(setComments)
      .catch((error: Error) => {
        if (error.name !== 'AbortError' && error.message !== 'Сессия истекла.') setCommentsError(error.message)
      })
      .finally(() => setCommentsLoading(false))

    apiFetch(`/api/tickets/${ticketId}/history`, requestOptions)
      .then(async (response) => {
        if (handleUnauthorized(response)) throw new Error('Сессия истекла.')
        if (response.status === 404) throw new Error('Заявка не найдена или недоступна.')
        if (!response.ok) throw new Error('Не удалось загрузить историю заявки.')
        return response.json() as Promise<TicketHistoryEntry[]>
      })
      .then(setHistory)
      .catch((error: Error) => {
        if (error.name !== 'AbortError' && error.message !== 'Сессия истекла.') setHistoryError(error.message)
      })
      .finally(() => setHistoryLoading(false))

    return () => controller.abort()
  }, [ticketId, refreshKey, reloadKey, token])

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanMessage = message.trim()
    if (!cleanMessage) {
      setSendError('Введите текст комментария.')
      return
    }
    if (cleanMessage.length > 2000) {
      setSendError('Комментарий не должен превышать 2000 символов.')
      return
    }

    setSendError('')
    setIsSending(true)
    try {
      const response = await apiFetch(`/api/tickets/${ticketId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: cleanMessage }),
      })
      const body = await response.json() as TicketComment & { message?: string }
      if (response.status === 401) {
        clearSession()
        navigate('/login', { replace: true })
        return
      }
      if (!response.ok) {
        setSendError(body.message ?? 'Не удалось отправить комментарий.')
        return
      }
      setComments((current) => [...current, body])
      setMessage('')
    } catch {
      setSendError('Сервер недоступен. Попробуйте ещё раз.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <>
    <TicketAttachments key={`${ticketId}:${token}`} ticketId={ticketId} onChanged={() => setReloadKey((value) => value + 1)} />
    <div className="ticket-activity-grid">
      <section className="activity-panel comments-panel" aria-labelledby="comments-title">
        <div className="activity-panel-heading">
          <div><p className="card-kicker">ОБСУЖДЕНИЕ</p><h2 id="comments-title">Комментарии</h2></div>
          <span className="activity-count">{commentsLoading ? '…' : comments.length}</span>
        </div>

        {commentsLoading ? (
          <div className="activity-state" role="status">Загружаем комментарии…</div>
        ) : commentsError ? (
          <div className="activity-error" role="alert">{commentsError}<button onClick={() => setReloadKey((value) => value + 1)} type="button">Повторить</button></div>
        ) : comments.length === 0 ? (
          <div className="activity-empty">Комментариев пока нет.</div>
        ) : (
          <div className="comment-list">
            {comments.map((comment) => (
              <article className="comment-item" key={comment.id}>
                <div className="comment-avatar" aria-hidden="true">{comment.user.name.trim().charAt(0).toUpperCase()}</div>
                <div className="comment-body">
                  <div className="comment-meta"><strong>{comment.user.name}</strong><span className={`role-pill role-pill--${comment.user.role}`}>{comment.user.role === 'engineer' ? 'Инженер' : comment.user.role === 'admin' ? 'Администратор' : 'Пользователь'}</span><time dateTime={comment.createdAt}>{formatTicketDate(comment.createdAt)}</time></div>
                  <p className="comment-message">{comment.message}</p>
                </div>
              </article>
            ))}
          </div>
        )}

        <form className="comment-form" onSubmit={submitComment}>
          <label className="field-label" htmlFor={`comment-${ticketId}`}>Новый комментарий</label>
          <textarea
            className="text-input comment-input"
            id={`comment-${ticketId}`}
            maxLength={2000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Напишите сообщение по заявке…"
            value={message}
          />
          {sendError && <div className="notice notice--error" role="alert">{sendError}</div>}
          <div className="comment-form-footer"><span>{message.length}/2000</span><button className="primary-button comment-submit" disabled={isSending || !message.trim()} type="submit">{isSending ? 'Отправляем…' : 'Отправить'}<span aria-hidden="true">→</span></button></div>
        </form>
      </section>

      <section className="activity-panel history-panel" aria-labelledby="history-title">
        <div className="activity-panel-heading"><div><p className="card-kicker">СОБЫТИЯ</p><h2 id="history-title">История заявки</h2></div></div>
        {historyLoading ? (
          <div className="activity-state" role="status">Загружаем историю…</div>
        ) : historyError ? (
          <div className="activity-error" role="alert">{historyError}<button onClick={() => setReloadKey((value) => value + 1)} type="button">Повторить</button></div>
        ) : history.length === 0 ? (
          <div className="activity-empty">История пока пуста.</div>
        ) : (
          <ol className="history-list">
            {history.map((entry) => (
              <li className="history-item" key={entry.id}>
                <span className={`history-marker history-marker--${entry.action}`} aria-hidden="true" />
                <div className="history-content">
                  <strong>{actionNames[entry.action] ?? entry.action}</strong>
                  {historyValue(entry) && <span>{historyValue(entry)}</span>}
                  <small>{entry.actor.name} · {entry.actor.role === 'engineer' ? 'Инженер' : entry.actor.role === 'admin' ? 'Администратор' : 'Пользователь'} · {formatTicketDate(entry.createdAt)}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
    </>
  )
}

export default TicketActivity
