import { apiFetch } from '../api/client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatTicketDate } from '../tickets/types'
import {
  attachmentAccept, canDeleteAttachment, checkAttachmentResponse,
  formatAttachmentSize, maximumAttachments, validateAttachment, type TicketAttachment,
} from '../tickets/attachments'

function TicketAttachments({ ticketId, onChanged }: { ticketId: number; onChanged: () => void }) {
  const { token, user, clearSession } = useAuth()
  const navigate = useNavigate()
  const [attachments, setAttachments] = useState<TicketAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const operation = useRef<AbortController | null>(null)
  const locked = useRef(false)
  const endpoint = `/api/tickets/${ticketId}/attachments`

  function unauthorized() {
    clearSession()
    navigate('/login', { replace: true })
  }

  useEffect(() => () => operation.current?.abort(), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    apiFetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        await checkAttachmentResponse(response, unauthorized)
        return response.json() as Promise<TicketAttachment[]>
      })
      .then((items) => { if (!controller.signal.aborted) setAttachments(items) })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : 'Не удалось загрузить вложения.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [ticketId, token, reloadKey])

  async function perform(label: string, task: (signal: AbortSignal) => Promise<void>, reconcile = false) {
    if (locked.current) return
    locked.current = true
    const controller = new AbortController()
    operation.current = controller
    setBusy(label)
    setError('')
    setSuccess('')
    try {
      await task(controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'Сервер недоступен. Попробуйте ещё раз.')
        // A failed response can follow a committed mutation; reload authoritative state.
        if (reconcile) {
          setReloadKey((value) => value + 1)
          onChanged()
        }
      }
    } finally {
      locked.current = false
      if (!controller.signal.aborted) setBusy(null)
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || loading || loadError || attachments.length >= maximumAttachments) return
    const validation = validateAttachment(file)
    if (validation) { setError(validation); return }
    const selected = file
    await perform('upload', async (signal) => {
      const data = new FormData()
      data.append('file', selected)
      const response = await apiFetch(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data, signal,
      })
      await checkAttachmentResponse(response, unauthorized)
      const added = await response.json() as TicketAttachment
      if (signal.aborted) return
      setAttachments((items) => [...items, added])
      setFile(null)
      if (input.current) input.current.value = ''
      setSuccess('Файл загружен.')
      onChanged()
    }, true)
  }

  async function download(attachment: TicketAttachment) {
    await perform(`download-${attachment.id}`, async (signal) => {
      const response = await apiFetch(`${endpoint}/${attachment.id}/download`, {
        headers: { Authorization: `Bearer ${token}` }, signal,
      })
      await checkAttachmentResponse(response, unauthorized)
      const blob = await response.blob()
      if (signal.aborted) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.originalName
      document.body.append(link)
      try { link.click() } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setSuccess('Файл передан браузеру для скачивания.')
    })
  }

  async function remove(attachment: TicketAttachment) {
    if (locked.current || !canDeleteAttachment(user, attachment)) return
    if (!window.confirm(`Удалить вложение «${attachment.originalName}»? Это действие нельзя отменить.`)) return
    await perform(`delete-${attachment.id}`, async (signal) => {
      const response = await apiFetch(`${endpoint}/${attachment.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal,
      })
      await checkAttachmentResponse(response, unauthorized)
      if (signal.aborted) return
      setAttachments((items) => items.filter((item) => item.id !== attachment.id))
      setSuccess('Вложение удалено.')
      onChanged()
    }, true)
  }

  return (
    <section className="activity-panel attachments-panel" aria-labelledby={`attachments-title-${ticketId}`} aria-busy={loading || busy !== null}>
      <div className="activity-panel-heading">
        <div><p className="card-kicker">ФАЙЛЫ ЗАЯВКИ</p><h2 id={`attachments-title-${ticketId}`}>Вложения</h2></div>
        <span className="activity-count">{loading ? '…' : `${attachments.length}/${maximumAttachments}`}</span>
      </div>
      {loading ? <div className="activity-state" role="status">Загружаем вложения…</div> : loadError ? (
        <div className="activity-error" role="alert">{loadError}<button type="button" onClick={() => setReloadKey((value) => value + 1)}>Повторить</button></div>
      ) : attachments.length === 0 ? <div className="activity-empty">Вложений пока нет.</div> : (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li className="attachment-item" key={attachment.id}>
              <div className="attachment-info">
                <strong>{attachment.originalName}</strong>
                <span>{formatAttachmentSize(attachment.sizeBytes)} · {attachment.uploadedBy.name} · {formatTicketDate(attachment.createdAt)}</span>
              </div>
              <div className="attachment-actions">
                <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => download(attachment)} aria-label={`Скачать ${attachment.originalName}`}>{busy === `download-${attachment.id}` ? 'Скачиваем…' : 'Скачать'}</button>
                {canDeleteAttachment(user, attachment) && <button className="danger-button" type="button" disabled={busy !== null} onClick={() => remove(attachment)} aria-label={`Удалить ${attachment.originalName}`}>{busy === `delete-${attachment.id}` ? 'Удаляем…' : 'Удалить'}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="attachment-form" onSubmit={upload}>
        <label className="field-label" htmlFor={`attachment-file-${ticketId}`}>Добавить файл</label>
        <p id={`attachment-help-${ticketId}`}>PNG, JPG, WEBP, PDF, TXT, DOCX · до 10 МБ · до 10 файлов. Пользователь и инженер удаляют свои файлы; администратор — любые.</p>
        <div className="attachment-upload-controls">
          <input ref={input} id={`attachment-file-${ticketId}`} type="file" accept={attachmentAccept} aria-describedby={`attachment-help-${ticketId}`} disabled={busy !== null || loading || Boolean(loadError) || attachments.length >= maximumAttachments} onChange={(event) => {
            const selected = event.target.files?.[0] ?? null
            setSuccess('')
            setError(selected ? validateAttachment(selected) : '')
            setFile(selected)
          }} />
          <button className="primary-button comment-submit" type="submit" disabled={busy !== null || loading || Boolean(loadError) || !file || Boolean(file && validateAttachment(file)) || attachments.length >= maximumAttachments}>{busy === 'upload' ? 'Загружаем…' : 'Загрузить'}</button>
        </div>
        {!loading && !loadError && attachments.length >= maximumAttachments && <p role="status">Достигнут лимит 10 вложений.</p>}
        {error && <div className="notice notice--error" role="alert">{error}</div>}
        {success && <div className="notice notice--success" role="status">{success}</div>}
      </form>
    </section>
  )
}

export default TicketAttachments
