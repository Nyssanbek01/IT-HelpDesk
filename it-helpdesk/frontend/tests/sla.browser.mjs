import assert from 'node:assert/strict'
import { startBrowser, waitUntil } from './browser-harness.mjs'

function bootstrap(role) {
  const user = { id: 1, name: 'SLA Browser', email: 'sla-browser@example.invalid', role }
  localStorage.setItem('it-helpdesk.token', 'sla-browser-token')
  localStorage.setItem('it-helpdesk.user', JSON.stringify(user))
  const createdAt = '2035-01-01T00:00:00Z'
  let elapsed = 0, serial = 100000
  const minuteCallbacks = new Map()
  const nativeInterval = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window)
  window.setInterval = (callback, duration, ...args) => {
    if (duration !== 60000) return nativeInterval(callback, duration, ...args)
    const id = ++serial; minuteCallbacks.set(id, () => callback(...args)); return id
  }
  window.clearInterval = (id) => { minuteCallbacks.delete(id); nativeClear(id) }
  Object.defineProperty(performance, 'now', { value: () => elapsed, configurable: true })
  // A wildly incorrect wall clock must not affect SLA countdowns.
  Date.now = () => 0
  const sla = {
    serverNow: '2035-01-01T00:13:00Z',
    response: { status: 'approaching_deadline', dueAt: '2035-01-01T00:15:00Z', completedAt: null, remainingMs: 120000 },
    resolution: { status: 'on_time', dueAt: '2035-01-01T04:00:00Z', completedAt: null, remainingMs: 227 * 60000 },
  }
  const ticket = { id: 1, title: 'SLA fixture', description: 'Test', status: 'new', priority: 'high', createdAt, updatedAt: createdAt, userId: 1, assignedEngineerId: role === 'engineer' ? 1 : null, assignedEngineer: null, user, responseDueAt: sla.response.dueAt, resolutionDueAt: sla.resolution.dueAt, firstRespondedAt: null, resolvedAt: null, slaTrackedFromCreation: true, sla }
  const urgent = { ...structuredClone(ticket), id: 2, title: 'Urgent fixture', resolutionDueAt: '2035-01-01T00:10:00Z' }
  urgent.sla.resolution = { status: 'overdue', dueAt: urgent.resolutionDueAt, completedAt: null, remainingMs: -180000 }
  const fixture = window.fixture = { ticket, urgent, calls: [], intervals: () => minuteCallbacks.size, advanceMinute: async () => { elapsed += 60000; for (const callback of [...minuteCallbacks.values()]) await callback() } }
  window.fetch = async (url, options = {}) => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const path = String(url)
    if (!path.startsWith('/api/')) throw new Error('Unexpected network request')
    if (options.headers?.Authorization !== 'Bearer sla-browser-token') throw new Error('Missing Authorization')
    fixture.calls.push({ path, method: options.method ?? 'GET' })
    if (path === '/api/auth/me') return Response.json(user)
    if (path === '/api/notifications/unread-count') return Response.json({ count: 0 })
    if (path === '/api/admin/engineers' || /\/(comments|history|attachments)$/.test(path)) return Response.json([])
    if (path === '/api/admin/stats') return Response.json({ totalTickets: 2, newTickets: 2, inProgressTickets: 0, resolvedTickets: 0, totalUsers: 3, engineers: 1, unassignedTickets: 1 })
    if (path === '/api/admin/sla/stats') return Response.json({ activeTickets: 2, responseOverdue: 0, resolutionOverdue: 1, approaching: 1, resolvedOnTime: 3, resolvedBreached: 1, compliancePercent: 75, eligibleResolved: 4, unknownResolved: 2 })
    if (path.endsWith('/take')) {
      ticket.status = 'in_progress'; ticket.firstRespondedAt = '2035-01-01T00:14:00Z'
      ticket.sla.response = { ...ticket.sla.response, status: 'met', completedAt: ticket.firstRespondedAt, remainingMs: null }
      return Response.json(ticket)
    }
    if (/\/tickets(?:\?|$)/.test(path)) {
      const query = new URL(path, location.origin).searchParams
      let items = [ticket, urgent]
      if (query.get('slaStatus') === 'overdue') items = [urgent]
      if (query.get('sort') === 'resolutionDueAt' || query.get('sortBy') === 'nearestDeadline') items = [...items].sort((a, b) => a.resolutionDueAt.localeCompare(b.resolutionDueAt))
      return Response.json({ items, total: items.length, page: 1, limit: 10, totalPages: 1, summary: { total: 2, new: 2, in_progress: 0, resolved: 0, assignedToMe: 1 } })
    }
    return Response.json(ticket)
  }
}

const browser = await startBrowser()
try {
  for (const role of ['user', 'engineer', 'admin']) {
    const path = role === 'user' ? '/tickets/1' : `/${role}/tickets/1`
    const page = await browser.newPage(`(${bootstrap.toString()})(${JSON.stringify(role)})`, path)
    const evaluate = page.evaluate
    try {
      await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Qyzylorda' })
      await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true })
      await waitUntil(() => evaluate(`document.querySelector('.sla-panel')?.textContent.includes('Осталось 2 мин')`), `${role} initial SLA`)
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
      assert.equal(await evaluate(`document.querySelector('.sla-stage--approaching_deadline') !== null`), true)
      assert.equal(await evaluate(`document.querySelector('.sla-panel').textContent.includes('05:15')`), true)
      await evaluate(`window.fixture.advanceMinute()`)
      await waitUntil(() => evaluate(`document.querySelector('.sla-panel')?.textContent.includes('Осталось 1 мин')`), 'monotonic countdown after one minute')
      await evaluate(`window.fixture.advanceMinute()`)
      await waitUntil(() => evaluate(`document.querySelector('.sla-countdown')?.textContent.includes('Дедлайн наступил')`), 'display deadline reached')
      assert.equal(await evaluate(`document.querySelector('.sla-stages .sla-stage').classList.contains('sla-stage--approaching_deadline')`), true)
      await evaluate(`window.fixture.ticket.sla.response.status = 'overdue'; window.fixture.ticket.sla.response.remainingMs = -60000; window.fixture.ticket.sla.serverNow = '2035-01-01T00:16:00Z'; window.fixture.advanceMinute()`)
      await waitUntil(() => evaluate(`document.querySelector('.sla-stages .sla-stage--overdue') !== null`), 'server decides overdue')
      if (role === 'engineer') {
        await evaluate(`[...document.querySelectorAll('.ticket-detail-actions button')].find(button => button.textContent.includes('Взять в работу')).click()`)
        await waitUntil(() => evaluate(`document.querySelector('.sla-panel').textContent.includes('Реакция: SLA выполнен')`), 'take an assigned ticket')
      }
      await evaluate(`window.fixture.ticket.sla.response = { status: 'unknown', dueAt: window.fixture.ticket.responseDueAt, completedAt: null, remainingMs: null }; window.fixture.ticket.sla.resolution = { status: 'unknown', dueAt: window.fixture.ticket.resolutionDueAt, completedAt: null, remainingMs: null }; window.fixture.ticket.sla.serverNow = '2035-01-01T00:17:00Z'; window.fixture.advanceMinute()`)
      await waitUntil(() => evaluate(`document.querySelectorAll('.sla-stages .sla-stage--unknown').length === 2`), 'unknown historical values')
      await evaluate(`window.fixture.ticket.status = 'resolved'; window.fixture.ticket.sla.resolution = { ...window.fixture.ticket.sla.resolution, status: 'met', completedAt: '2035-01-01T00:18:00Z' }; window.fixture.ticket.sla.serverNow = '2035-01-01T00:18:00Z'; window.fixture.advanceMinute()`)
      await waitUntil(() => evaluate(`document.querySelector('.sla-panel').textContent.includes('Решение: SLA выполнен') && window.fixture.intervals() === 0`), 'remote completion stops minute timer')
      await evaluate(`document.querySelector('.topbar-logout').click()`)
      await waitUntil(() => evaluate(`location.pathname === '/login' && window.fixture.intervals() === 0`), 'all minute timers cleaned on logout')
      console.log(`PASS ${role}: 360px, UTC/local date, wrong client clock, controlled minute countdown, backend-only status, historical unknown, timer cleanup`)
    } finally { await page.close() }
  }
  for (const [role, path] of [['user', '/tickets'], ['engineer', '/engineer'], ['admin', '/admin']]) {
    const page = await browser.newPage(`(${bootstrap.toString()})(${JSON.stringify(role)})`, path)
    const evaluate = page.evaluate
    try {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true })
      const selector = role === 'admin' ? '.sla-analytics' : '.sla-compact'
      await waitUntil(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), `${role} dashboard SLA`)
      if (role === 'engineer') {
        assert.equal(await evaluate(`document.querySelector('.engineer-table--row .ticket-number').textContent`), '#2')
        assert.equal(await evaluate(`document.querySelectorAll('.ticket-row--overdue').length`), 1)
        await evaluate(`(() => { const select = document.querySelector('select[aria-label="SLA"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'overdue'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
        await waitUntil(() => evaluate(`document.querySelectorAll('.engineer-table--row').length === 1`), 'engineer overdue filter')
      }
      if (role === 'admin') {
        await waitUntil(() => evaluate(`document.querySelector('.sla-analytics').textContent.includes('75%')`), 'SLA compliance analytics')
        await evaluate(`document.querySelector('.sla-analytics-heading a').click()`)
        await waitUntil(() => evaluate(`location.pathname === '/admin/tickets' && document.querySelectorAll('.admin-table--row').length === 1`), 'problem-ticket quick link')
        assert.equal(await evaluate(`new URLSearchParams(location.search).get('slaStatus')`), 'overdue')
        assert.equal(await evaluate(`document.querySelector('select[aria-label="SLA"]').value`), 'overdue')
      }
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
      console.log(`PASS ${role}: SLA list/dashboard and filters, 360px without overflow`)
    } finally { await page.close() }
  }
} finally { await browser.close() }
