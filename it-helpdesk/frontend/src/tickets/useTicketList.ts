import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../api/client'
import { useSlaRefresh } from './useSlaRefresh'
import type { EngineerTicket } from './types'
export type TicketListResult = { items: EngineerTicket[]; page: number; limit: number; total: number; totalPages: number; summary: { total: number; new: number; in_progress: number; resolved: number; assignedToMe: number } }
export function useTicketList(role: 'user' | 'engineer' | 'admin') {
  const { token, clearSession } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState(params.get('search') ?? '')
  const revision = useSlaRefresh()
  const [retry, setRetry] = useState(0)
  const apiParams = new URLSearchParams(params)
  apiParams.delete('scope')
  if (role === 'engineer' && params.get('scope') === 'mine') apiParams.set('assignedEngineerId', 'me')
  if (!apiParams.has('sortBy') && !apiParams.has('sort') && role === 'engineer') apiParams.set('sortBy', 'nearestDeadline')
  const key = `${role}:${token}:${apiParams}`
  const query = apiParams.toString()
  const [state, setState] = useState<{ key: string; result?: TicketListResult; error?: string; loading: boolean }>({ key: '', loading: true })
  const update = useCallback((name: string, value: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value && value !== 'all' && value !== 'any') next.set(name, value); else next.delete(name)
      if (name !== 'page') next.delete('page')
      if (name === 'limit') next.delete('pageSize')
      if (name === 'sortBy') { next.delete('sort'); next.delete('sortOrder') }
      return next
    })
  }, [setParams])
  const urlSearch = params.get('search') ?? ''
  useEffect(() => { setDraft(urlSearch) }, [urlSearch])
  useEffect(() => {
    if (draft === urlSearch) return
    const timer = window.setTimeout(() => update('search', draft.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [draft, urlSearch, update])
  useEffect(() => {
    const controller = new AbortController()
    setState({ key, loading: true })
    const endpoint = role === 'user' ? '/api/tickets' : `/api/${role}/tickets`
    apiFetch(`${endpoint}?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) { clearSession(); navigate('/login', { replace: true }); throw new Error('Сессия истекла.') }
        if (response.status === 403) throw new Error('Недостаточно прав для просмотра заявок.')
        if (response.status === 400) throw new Error('Некорректные параметры фильтров. Сбросьте фильтры и попробуйте снова.')
        if (!response.ok) throw new Error('Не удалось загрузить заявки. Попробуйте ещё раз.')
        return response.json() as Promise<TicketListResult>
      }).then((result) => { if (!controller.signal.aborted) setState({ key, result, loading: false }) })
      .catch((reason: Error) => { if (!controller.signal.aborted) setState({ key, error: reason.message, loading: false }) })
    return () => controller.abort()
  }, [key, query, token, role, revision, retry])
  return { params, draft, setDraft, update, reset: () => { setDraft(''); setParams(params.get('scope') === 'mine' ? { scope: 'mine' } : {}) }, result: state.key === key ? state.result : undefined, error: state.key === key ? state.error : undefined, loading: state.key !== key || state.loading, retry: () => setRetry((value) => value + 1) }
}
export type TicketListControls = ReturnType<typeof useTicketList>
