import { Link } from 'react-router-dom'
import { useTicketList } from '../tickets/useTicketList'
import TicketList from '../components/TicketList'
import { TicketFilters, TicketPagination } from '../components/TicketListControls'
export default function TicketsPage() {
  const list = useTicketList('user')
  return <main className="dashboard-content ticket-page-content">
    <div className="dashboard-heading"><div><p className="eyebrow"><span /> РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Мои заявки</h1><p className="dashboard-welcome">Поиск и контроль ваших обращений</p></div><Link className="primary-button create-ticket-button" to="/tickets/new">＋ Создать заявку</Link></div>
    <TicketFilters list={list} role="user" /><TicketList list={list} role="user" /><TicketPagination list={list} />
  </main>
}
