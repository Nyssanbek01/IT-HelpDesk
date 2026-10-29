import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../api/client'
import { useTicketList } from '../tickets/useTicketList'
import TicketList from '../components/TicketList'
import { TicketFilters, TicketPagination } from '../components/TicketListControls'
export default function AdminTicketsPage() {
  const list = useTicketList('admin')
  const { token } = useAuth()
  const [engineers, setEngineers] = useState<Array<{ id: number; name: string }>>([])
  useEffect(() => {
    const controller = new AbortController()
    apiFetch('/api/admin/engineers', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<Array<{ id: number; name: string }>> : [])
      .then((items) => { if (!controller.signal.aborted) setEngineers(items) }).catch(() => {})
    return () => controller.abort()
  }, [token])
  return <main className="dashboard-content admin-content">
    <div className="dashboard-heading admin-page-heading"><div><p className="eyebrow"><span /> ADMIN PANEL</p><h1>Все заявки</h1><p className="dashboard-welcome">Поиск, фильтрация и назначение инженеров</p></div><span className="admin-total">{list.result?.total ?? '—'} заявок</span></div>
    <TicketFilters list={list} role="admin" engineers={engineers} /><TicketList list={list} role="admin" /><TicketPagination list={list} />
  </main>
}
