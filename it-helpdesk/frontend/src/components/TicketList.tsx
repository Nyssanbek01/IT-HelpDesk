import { Link } from 'react-router-dom'
import type { TicketListControls } from '../tickets/useTicketList'
import { formatTicketDate, priorityLabels, statusLabels } from '../tickets/types'
import TicketSla from './TicketSla'
export default function TicketList({ list, role }: { list: TicketListControls; role: 'user' | 'engineer' | 'admin' }) {
  if (list.loading) return <div className="ticket-list-state" role="status">Загружаем заявки…</div>
  if (list.error) return <div className="activity-error" role="alert">{list.error}<button type="button" onClick={list.retry}>Повторить</button></div>
  if (!list.result?.items.length) return <div className="ticket-list-state">Заявки не найдены.</div>
  const prefix = role === 'user' ? '' : `/${role}`
  const rowClass = role === 'admin' ? 'admin-ticket-table admin-table--row' : role === 'engineer' ? 'engineer-table engineer-table--row' : 'ticket-table--row'
  const headClass = role === 'admin' ? 'admin-ticket-table admin-table--head' : role === 'engineer' ? 'engineer-table engineer-table--head' : 'ticket-table--head'
  return <section className={`ticket-table-wrap ${role === 'admin' ? 'admin-table-wrap' : role === 'engineer' ? 'engineer-table-wrap' : ''}`} aria-label="Список заявок">
    <div className={`ticket-table ${headClass}`} aria-hidden="true"><span>№</span><span>Название и SLA</span>{role !== 'user' && <span>Автор</span>}<span>Статус</span><span>Приоритет</span>{role !== 'user' && <span>Инженер</span>}<span>Создана</span></div>
    <div className="ticket-table-body">{list.result.items.map((ticket) => <Link className={`ticket-table ${rowClass}${ticket.sla?.response.status === 'overdue' || ticket.sla?.resolution.status === 'overdue' ? ' ticket-row--overdue' : ''}`} key={ticket.id} to={`${prefix}/tickets/${ticket.id}`}>
      <span className="ticket-number">#{ticket.id}</span><span className="ticket-title-cell ticket-title-cell--sla">{ticket.title}<TicketSla ticket={ticket} compact /></span>
      {role !== 'user' && <span className={role === 'admin' ? 'admin-author-cell' : 'engineer-author-cell'}>{ticket.user.name}</span>}
      <span><span className={`ticket-badge ticket-badge--${ticket.status}`}>{statusLabels[ticket.status]}</span></span><span className={`priority-label priority-label--${ticket.priority}`}>{priorityLabels[ticket.priority]}</span>
      {role !== 'user' && <span className={role === 'admin' ? 'admin-engineer-cell' : 'engineer-assignee-cell'}>{ticket.assignedEngineer?.name ?? 'Не назначен'}</span>}<span className="ticket-date">{formatTicketDate(ticket.createdAt)}</span>
    </Link>)}</div>
  </section>
}
