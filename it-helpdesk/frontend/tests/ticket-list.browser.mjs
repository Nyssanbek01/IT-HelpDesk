import assert from 'node:assert/strict'
import { startBrowser, waitUntil } from './browser-harness.mjs'

function bootstrap(role) {
  const user = { id: 1, role, name: 'List Browser', email: 'list@example.invalid' }
  localStorage.setItem('it-helpdesk.token', 'list-browser-token')
  localStorage.setItem('it-helpdesk.user', JSON.stringify(user))
  const timers = new Map(), nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window)
  let timerId = 90000
  window.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds !== 350) return nativeTimeout(callback, milliseconds, ...args)
    const id = ++timerId; timers.set(id, () => callback(...args)); return id
  }
  window.clearTimeout = (id) => { timers.delete(id); nativeClear(id) }
  const items = Array.from({ length: 30 }, (_, i) => {
    const createdAt = `2035-01-0${1 + Math.floor(i / 10)}T00:00:00Z`
    return { id: i + 1, title: `${i < 15 ? 'Alpha' : 'Beta'} ${i}`, description: `Description ${i}`, status: ['new', 'in_progress', 'resolved'][i % 3], priority: ['high', 'medium', 'low'][i % 3], userId: 1, assignedEngineerId: i % 2 ? 1 : null, assignedEngineer: i % 2 ? user : null, user, createdAt, updatedAt: createdAt, resolutionDueAt: createdAt, sla: { serverNow: createdAt, response: { status: 'on_time', dueAt: createdAt, completedAt: null, remainingMs: 600000 }, resolution: { status: i % 2 ? 'overdue' : 'on_time', dueAt: createdAt, completedAt: null, remainingMs: i % 2 ? -1 : 600000 } } }
  })
  const fixture = window.fixture = { calls: [], aborted: 0, fail: false, pendingSlow: null, timers: () => timers.size, flush: () => { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback() } }
  window.fetch = async (input, options = {}) => {
    const path = String(input), url = new URL(path, location.origin), q = url.searchParams
    if (!path.startsWith('/api/')) throw new Error('Unexpected network request')
    if (options.headers?.Authorization !== 'Bearer list-browser-token') throw new Error('Missing token')
    fixture.calls.push(path)
    if (url.pathname === '/api/auth/me') return Response.json(user)
    if (url.pathname === '/api/notifications/unread-count') return Response.json({ count: 0 })
    if (url.pathname === '/api/admin/engineers') return Response.json([user])
    if (/\/(comments|history|attachments)$/.test(url.pathname)) return Response.json([])
    if (!/\/tickets$/.test(url.pathname)) return Response.json(items.find((item) => item.id === Number(url.pathname.split('/').pop())) ?? items[0])
    if (fixture.fail) return new Response('failure', { status: 500 })
    let filtered = [...items]
    const search = q.get('search') ?? ''
    const summary = { total: 30, new: 10, in_progress: 10, resolved: 10, assignedToMe: 15 }
    if (search === 'slow' || search === 'fast') {
      const result = { items: [{ ...items[0], title: `${search} result` }], total: 1, page: 1, limit: 10, totalPages: 1, summary }
      if (search === 'slow') {
        options.signal?.addEventListener('abort', () => fixture.aborted++)
        // Intentionally ignore abort at the transport layer: UI must still reject stale results.
        return new Promise((resolve) => { fixture.pendingSlow = () => resolve(Response.json(result)) })
      }
      return Response.json(result)
    }
    if (search) filtered = filtered.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase()))
    for (const name of ['status', 'priority']) if (q.get(name) && q.get(name) !== 'all') filtered = filtered.filter((item) => item[name] === q.get(name))
    if (q.get('dateFrom')) filtered = filtered.filter((item) => item.createdAt.slice(0, 10) >= q.get('dateFrom'))
    if (q.get('dateTo')) filtered = filtered.filter((item) => item.createdAt.slice(0, 10) <= q.get('dateTo'))
    if (q.get('assignedEngineerId') === 'me' || q.get('assignedEngineerId') === '1') filtered = filtered.filter((item) => item.assignedEngineerId === 1)
    if (q.get('slaStatus') === 'overdue') filtered = filtered.filter((item) => item.sla.resolution.status === 'overdue')
    const field = q.get('sortBy') ?? 'createdAt', order = q.get('sortOrder') ?? (field === 'nearestDeadline' ? 'asc' : 'desc')
    filtered.sort((a, b) => order === 'asc' ? a.id - b.id : b.id - a.id)
    const page = Number(q.get('page') ?? 1), limit = Number(q.get('limit') ?? 10)
    return Response.json({ items: filtered.slice((page - 1) * limit, page * limit), total: filtered.length, page, limit, totalPages: Math.ceil(filtered.length / limit), summary })
  }
}

const browser = await startBrowser()
try {
  for (const role of ['user', 'engineer', 'admin']) {
    const path = role === 'user' ? '/tickets' : role === 'engineer' ? '/engineer' : '/admin/tickets'
    const page = await browser.newPage(`(${bootstrap.toString()})(${JSON.stringify(role)})`, path)
    const evaluate = page.evaluate
    const rows = `document.querySelectorAll('.ticket-table-body > a')`
    const ready = (expression, label) => waitUntil(() => evaluate(expression), `${role}: ${label}`)
    const input = async (label, value, select = false) => evaluate(`(() => { const field = document.querySelector(${JSON.stringify(`${select ? 'select' : 'input'}[aria-label="${label}"]`)}); Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('${select ? 'change' : 'input'}', { bubbles: true })); })()`)
    try {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true })
      await ready(`${rows}.length === 10`, 'first server page')
      assert.equal(await evaluate(`document.querySelector('.ticket-pagination').textContent.includes('Всего: 30')`), true)
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
      await evaluate(`[...document.querySelectorAll('.ticket-pagination button')].find(button => button.textContent === 'Далее').click()`)
      await ready(`new URLSearchParams(location.search).get('page') === '2' && ${rows}.length === 10`, 'next page URL')
      const baseline = await evaluate(`window.fixture.calls.filter(path => path.includes('/tickets?')).length`)
      for (const value of ['A', 'Al', 'Alpha']) await input('Поиск заявок', value)
      await ready(`window.fixture.timers() === 1`, 'debounce scheduled')
      assert.equal(await evaluate(`window.fixture.calls.filter(path => path.includes('/tickets?')).length`), baseline)
      await evaluate(`window.fixture.flush()`)
      await ready(`document.querySelector('.ticket-pagination').textContent.includes('Всего: 15') && ${rows}.length === 10`, 'debounced search')
      assert.equal(await evaluate(`new URLSearchParams(location.search).has('page')`), false)
      assert.equal(await evaluate(`window.fixture.calls.filter(path => path.includes('/tickets?')).length`), baseline + 1)
      await input('На странице', '20', true)
      await ready(`${rows}.length === 15`, 'page size')
      await page.send('Page.reload')
      await ready(`${rows}.length === 15 && document.querySelector('input[type=search]').value === 'Alpha'`, 'reload retains URL filters')
      await input('Статус', 'new', true); await input('Приоритет', 'high', true)
      await input('Дата с', '2035-01-01'); await input('Дата по', '2035-01-02'); await input('SLA', 'overdue', true)
      if (role === 'admin') await input('Инженер', '1', true)
      await ready(`${rows}.length === 2`, 'combined filters')
      await input('Сортировка', 'priority', true); await input('Порядок', 'asc', true)
      await ready(`window.fixture.calls.some(path => path.includes('sortBy=priority') && path.includes('sortOrder=asc'))`, 'sort allowlist parameters')
      await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Сбросить фильтры').click()`)
      await ready(`${rows}.length === 10 && !location.search`, 'reset')
      await input('Поиск заявок', 'slow'); await ready(`window.fixture.timers() === 1`, 'slow debounce'); await evaluate(`window.fixture.flush()`)
      await ready(`window.fixture.pendingSlow !== null`, 'slow request in flight')
      assert.equal(await evaluate(`${rows}.length`), 0)
      await input('Поиск заявок', 'fast'); await ready(`window.fixture.timers() === 1`, 'fast debounce'); await evaluate(`window.fixture.flush()`)
      await ready(`document.querySelector('.ticket-title-cell')?.textContent.startsWith('fast result')`, 'fast result shown')
      await evaluate(`window.fixture.pendingSlow()`)
      await ready(`window.fixture.aborted >= 1`, 'obsolete transport aborted')
      assert.equal(await evaluate(`document.querySelector('.ticket-title-cell').textContent.startsWith('fast result')`), true)
      await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Сбросить фильтры').click()`)
      await ready(`${rows}.length === 10`, 'reset after stale response')
      await evaluate(`window.fixture.fail = true`); await input('Статус', 'in_progress', true)
      await ready(`document.querySelector('[role=alert]') !== null`, 'error')
      assert.equal(await evaluate(`${rows}.length`), 0)
      await evaluate(`window.fixture.fail = false; document.querySelector('.activity-error button').click()`)
      await ready(`${rows}.length === 10`, 'retry')
      await input('Поиск заявок', 'no-match'); await ready(`window.fixture.timers() === 1`, 'empty debounce'); await evaluate(`window.fixture.flush()`)
      await ready(`document.querySelector('.ticket-pagination').textContent.includes('Всего: 0')`, 'empty result')
      await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Сбросить фильтры').click()`)
      await ready(`${rows}.length === 10`, 'final reset')
      assert.equal(await evaluate(`window.fixture.calls.every(path => !path.includes('list-browser-token'))`), true)
      const target = await evaluate(`document.querySelector('.ticket-table-body > a').getAttribute('href')`)
      await evaluate(`document.querySelector('.ticket-table-body > a').click()`)
      await ready(`location.pathname === ${JSON.stringify(target)} && document.querySelector('.ticket-detail-panel') !== null`, 'detail navigation')
      console.log(`PASS ${role}: 360px, server pages/totals, debounce, URL/reload/reset, combined filters, sort, abort/stale guard, loading/empty/error/retry, detail routes`)
    } finally { await page.close() }
  }
} finally { await browser.close() }
