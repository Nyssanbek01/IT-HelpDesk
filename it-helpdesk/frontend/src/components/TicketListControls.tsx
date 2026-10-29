import type { TicketListControls as Controls } from '../tickets/useTicketList'
import { slaFilterOptions } from '../tickets/sla'
export function TicketFilters({ list, role, engineers = [] }: { list: Controls; role: 'user' | 'engineer' | 'admin'; engineers?: Array<{ id: number; name: string }> }) {
  const select = (name: string, label: string, options: Array<[string, string]>, fallback = 'all') => <label>{label}<select aria-label={label} className="admin-filter-select" value={list.params.get(name) ?? fallback} onChange={(event) => list.update(name, event.target.value)}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
  return <section className="ticket-list-filters" aria-label="Поиск и фильтры заявок">
    <label className="ticket-list-search">Поиск<input className="text-input" aria-label="Поиск заявок" type="search" maxLength={100} placeholder="Название, описание или #ID" value={list.draft} onChange={(event) => list.setDraft(event.target.value)} /></label>
    {select('status', 'Статус', [['all', 'Все'], ['new', 'Новая'], ['in_progress', 'В работе'], ['resolved', 'Решена']])}
    {select('priority', 'Приоритет', [['all', 'Все'], ['low', 'Низкий'], ['medium', 'Средний'], ['high', 'Высокий']])}
    {role === 'admin' && select('assignedEngineerId', 'Инженер', [['all', 'Все'], ['unassigned', 'Не назначен'], ...engineers.map((engineer): [string, string] => [String(engineer.id), engineer.name])])}
    <label>Создана с (UTC)<input className="text-input" aria-label="Дата с" type="date" value={list.params.get('dateFrom') ?? ''} onChange={(event) => list.update('dateFrom', event.target.value)} /></label>
    <label>Создана по (UTC)<input className="text-input" aria-label="Дата по" type="date" value={list.params.get('dateTo') ?? ''} onChange={(event) => list.update('dateTo', event.target.value)} /></label>
    {select('slaStatus', 'SLA', [['all', 'Все'], ...slaFilterOptions])}
    {select('slaStage', 'Этап SLA', [['any', 'Любой'], ['response', 'Реакция'], ['resolution', 'Решение']], 'any')}
    {select('sortBy', 'Сортировка', [['createdAt', 'Дата создания'], ['updatedAt', 'Дата изменения'], ['priority', 'Приоритет'], ['resolutionDueAt', 'Срок решения'], ['nearestDeadline', 'Ближайший дедлайн — активные первыми']], role === 'engineer' ? 'nearestDeadline' : 'createdAt')}
    {select('sortOrder', 'Порядок', [['desc', 'По убыванию'], ['asc', 'По возрастанию']], ['resolutionDueAt', 'nearestDeadline'].includes(list.params.get('sortBy') ?? (role === 'engineer' ? 'nearestDeadline' : 'createdAt')) ? 'asc' : 'desc')}
    {select('limit', 'На странице', [['10', '10'], ['20', '20'], ['50', '50']], '10')}
    <button className="secondary-button" type="button" onClick={list.reset}>Сбросить фильтры</button>
  </section>
}
export function TicketPagination({ list }: { list: Controls }) {
  const result = list.result, page = result?.page ?? Number(list.params.get('page') ?? 1)
  return <nav className="admin-pagination ticket-pagination" aria-label="Страницы заявок"><span role="status">{result ? `Всего: ${result.total} · Страница ${result.page} из ${Math.max(result.totalPages, 1)}` : list.loading ? 'Загружаем…' : ''}</span><div><button className="secondary-button" type="button" disabled={list.loading || page <= 1} onClick={() => list.update('page', String(page - 1))}>Назад</button><button className="secondary-button" type="button" disabled={list.loading || !result || page >= result.totalPages} onClick={() => list.update('page', String(page + 1))}>Далее</button></div></nav>
}
