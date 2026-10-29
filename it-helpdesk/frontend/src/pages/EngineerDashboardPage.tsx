import { Link } from 'react-router-dom'
import { useTicketList } from '../tickets/useTicketList'
import TicketList from '../components/TicketList'
import { TicketFilters, TicketPagination } from '../components/TicketListControls'
export default function EngineerDashboardPage() {
  const list = useTicketList('engineer')
  const mine = list.params.get('scope') === 'mine'
  const summary = list.result?.summary
  const cards = [['Новые', summary?.new], ['В работе', summary?.in_progress], ['Решено', summary?.resolved], ['Назначено мне', summary?.assignedToMe]] as const
  return <main className="dashboard-content engineer-content">
    <div className="dashboard-heading"><div><p className="eyebrow"><span /> ПАНЕЛЬ ИНЖЕНЕРА</p><h1>{mine ? 'Мои заявки' : 'Панель инженера'}</h1><p className="dashboard-welcome">Очередь обращений технической поддержки</p></div></div>
    <div className="stats-grid engineer-stats" aria-label="Статистика заявок">{cards.map(([title, value], index) => <article className="stat-card stat-card--total" key={title}><div className="stat-card-top"><span>{title}</span><span className="stat-icon stat-icon--total" aria-hidden="true">0{index + 1}</span></div><div className="stat-value">{value ?? '—'}</div><div className="stat-caption">По всей доступной очереди</div></article>)}</div>
    <section className="engineer-ticket-section"><div className="engineer-list-heading"><div><h2>{mine ? 'Мои заявки' : 'Все заявки'}</h2><p>Серверный поиск и ближайшие сроки</p></div><div className="ticket-filter"><Link className={`ticket-filter-link${mine ? '' : ' ticket-filter-link--active'}`} to="/engineer">Все</Link><Link className={`ticket-filter-link${mine ? ' ticket-filter-link--active' : ''}`} to="/engineer?scope=mine">Назначено мне</Link></div></div>
      <TicketFilters list={list} role="engineer" /><TicketList list={list} role="engineer" /><TicketPagination list={list} />
    </section>
  </main>
}
