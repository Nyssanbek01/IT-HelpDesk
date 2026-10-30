import assert from 'node:assert/strict'
import { startBrowser, waitUntil } from './browser-harness.mjs'

function bootstrap(role) {
  const user = { id: 1, role, name: 'Analytics Browser', email: 'analytics@example.invalid' }
  localStorage.setItem('it-helpdesk.token', 'analytics-browser-token'); localStorage.setItem('it-helpdesk.user', JSON.stringify(user))
  const fixture = window.fixture = { calls: [], downloads: [], pending: [], holdWeek: false, aborted: 0, fail: 0, empty: false, value: 7, alerted: false }
  window.alert = () => { fixture.alerted = true }
  HTMLAnchorElement.prototype.click = function () { if (this.download) fixture.downloads.push({ name: this.download, url: this.href }) }
  window.fetch = async (input, options = {}) => {
    const path = String(input), url = new URL(path, location.origin), q = url.searchParams
    if (!path.startsWith('/api/')) throw new Error('Unexpected network request')
    if (options.headers?.Authorization !== 'Bearer analytics-browser-token') throw new Error('Missing JWT')
    fixture.calls.push(path)
    if (url.pathname === '/api/auth/me') return Response.json(user)
    if (url.pathname === '/api/notifications/unread-count') return Response.json({ count: 0 })
    if (!url.pathname.startsWith('/api/admin/analytics/')) return Response.json({ items: [], summary: { total: 0, new: 0, in_progress: 0, resolved: 0, assignedToMe: 0 }, page: 1, limit: 10, total: 0, totalPages: 0 })
    if (fixture.fail) return new Response('failure', { status: fixture.fail })
    const kind = url.pathname.split('/').pop()
    if (kind === 'export') return new Response('\ufeff"Раздел","Показатель","Значение"\r\n"Обзор","Создано",7\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="analytics.csv"' } })
    const selected = q.get('engineerId') === '1', empty = fixture.empty
    const count = empty ? 0 : selected ? 6 : fixture.value
    const range = { dateFrom: q.get('dateFrom') ?? '2035-01-01', dateTo: q.get('dateTo') ?? '2035-01-03', interval: q.get('interval') ?? 'day', timezone: 'UTC', asOf: '2035-01-04T00:00:00Z', engineerId: selected ? 1 : null }
    const share = empty ? { numerator: 0, denominator: 0, percent: null, unknown: 0 } : { numerator: 3, denominator: 4, percent: 75, unknown: 1 }
    const overview = { range, created: count, resolved: empty ? 0 : selected ? 2 : 5, activeNow: 3, activeAtPeriodEnd: null, activeAtPeriodEndReason: 'Полная история не гарантирована.', distributionsBasis: 'Текущее состояние созданных за период.', statuses: empty ? {} : { new: 0, in_progress: 1, resolved: count - 1 }, priorities: empty ? {} : { high: count }, averageResponse: { milliseconds: empty ? null : 1200000, samples: empty ? 0 : 3, excluded: empty ? 0 : 4, basis: 'Создание' }, averageResolution: { milliseconds: empty ? null : 22320000, samples: empty ? 0 : 5, basis: 'Решение' }, resolutionSla: share, unplacedResolvedGlobal: 2, excludedResolutionEvents: 1 }
    const buckets = range.interval === 'day' ? [2, 3, Math.max(0, count - 5)].map((value, index) => ({ bucket: `2035-01-0${index + 1}T00:00:00Z`, created: empty ? 0 : value, resolved: empty ? 0 : index === 2 ? 1 : 2 })) : [{ bucket: '2035-01-01T00:00:00Z', created: count, resolved: empty ? 0 : 5 }]
    const optionsList = [{ id: 1, name: '<img src=x onerror=alert(1)> Инженер' }, { id: 2, name: 'Второй инженер' }]
    const team = { range, options: optionsList, items: optionsList.filter((item) => !selected || item.id === 1).map((item) => ({ ...item, activeAssigned: 1, resolved: empty ? 0 : item.id === 1 ? 2 : 0, averageResolutionMs: empty || item.id === 2 ? null : 50400000, resolutionSla: item.id === 2 ? { numerator: 0, denominator: 0, percent: null, unknown: 0 } : share })), attribution: { unknownActor: 2, otherActor: 1, rule: 'Исполнитель по истории, не по текущему назначению.' } }
    const payload = kind === 'overview' ? overview : kind === 'tickets-trend' ? { range, buckets } : kind === 'engineers' ? team : { range, response: share, resolution: share, basis: 'Разные когорты; неизвестные не входят в знаменатель.' }
    if (fixture.holdWeek && range.interval === 'week') {
      if (kind === 'overview') payload.created = 999
      options.signal?.addEventListener('abort', () => fixture.aborted++)
      return new Promise((resolve) => fixture.pending.push(() => resolve(Response.json(payload))))
    }
    return Response.json(payload)
  }
}

const browser = await startBrowser()
try {
  const path = '/admin/analytics?dateFrom=2035-01-01&dateTo=2035-01-03'
  const page = await browser.newPage(`(${bootstrap.toString()})('admin')`, path)
  const evaluate = page.evaluate
  const ready = (expression, label) => waitUntil(() => evaluate(expression), label)
  const field = async (label, value, select = false) => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(`${select ? 'select' : 'input'}[aria-label="${label}"]`)}); Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('${select ? 'change' : 'input'}', { bubbles: true })); })()`)
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true })
    await ready(`document.querySelectorAll('.analytics-chart-card canvas').length === 5`, 'real Chart.js canvases')
    assert.equal(await evaluate(`document.querySelector('.analytics-metric-value').textContent`), '7')
    assert.equal(await evaluate(`document.querySelectorAll('.analytics-engineer-table tbody tr').length`), 2)
    assert.equal(await evaluate(`document.querySelector('.analytics-engineer-table img') === null && !window.fixture.alerted`), true)
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
    assert.equal(await evaluate(`document.querySelector('.analytics-chart-card .analytics-data-table tbody tr td').textContent`), '2')
    assert.equal(await evaluate(`document.querySelector('.analytics-metrics').textContent.includes('Недоступно')`), true)
    assert.equal(await evaluate(`document.querySelector('.sidebar-link[href="/admin/analytics"]').getAttribute('aria-current')`), 'page')
    await field('Инженер аналитики', '1', true)
    await ready(`document.querySelector('.analytics-metric-value')?.textContent === '6' && document.querySelectorAll('.analytics-engineer-table tbody tr').length === 1`, 'engineer filter')
    await field('Группировка', 'month', true)
    await ready(`document.querySelector('.analytics-chart-card .analytics-data-table tbody')?.children.length === 1`, 'month grouping')
    await page.send('Page.reload')
    await ready(`document.querySelector('select[aria-label="Инженер аналитики"]')?.value === '1' && document.querySelector('select[aria-label="Группировка"]').value === 'month' && document.querySelectorAll('canvas').length === 5`, 'URL reload filters')
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Экспорт CSV').click()`)
    await ready(`window.fixture.downloads.length === 1`, 'authenticated CSV download')
    assert.ok((await evaluate(`window.fixture.downloads[0].url`)).startsWith('blob:'))
    assert.equal(await evaluate(`window.fixture.calls.filter(path => path.includes('/export?')).every(path => path.includes('engineerId=1') && path.includes('interval=month') && !path.includes('analytics-browser-token'))`), true)
    await evaluate(`window.fixture.empty = true`); await field('Группировка', 'day', true)
    await ready(`document.querySelector('.analytics-metrics')?.textContent.includes('Нет достоверных данных') && document.querySelector('.analytics-content').textContent.includes('За период нет подтверждённых')`, 'empty and unknown states')
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
    await evaluate(`window.fixture.fail = 500`); await field('Группировка', 'week', true)
    await ready(`document.querySelector('.analytics-content [role=alert]') !== null`, 'error')
    assert.equal(await evaluate(`document.querySelectorAll('.analytics-chart-card').length`), 0)
    await evaluate(`window.fixture.fail = 0; window.fixture.empty = false; document.querySelector('.activity-error button').click()`)
    await ready(`document.querySelectorAll('canvas').length === 5`, 'retry')
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Сбросить период').click()`)
    await ready(`!location.search && document.querySelector('.analytics-metric-value')?.textContent === '7'`, 'reset')
    await evaluate(`window.fixture.holdWeek = true`); await field('Группировка', 'week', true)
    await ready(`window.fixture.pending.length === 4`, 'old requests held')
    assert.equal(await evaluate(`document.querySelectorAll('canvas').length`), 0)
    await field('Группировка', 'month', true)
    await ready(`document.querySelector('.analytics-metric-value')?.textContent === '7'`, 'new filter response')
    await evaluate(`window.fixture.pending.forEach(resolve => resolve()); new Promise(resolve => setTimeout(resolve, 0))`)
    assert.equal(await evaluate(`document.querySelector('.analytics-metric-value').textContent`), '7')
    assert.equal(await evaluate(`window.fixture.aborted`), 4)
    await evaluate(`window.fixture.value = 13`); await field('Период с', '2035-01-02')
    await ready(`document.querySelector('.analytics-metric-value')?.textContent === '13' && document.querySelector('.analytics-chart-card .analytics-data-table tbody tr td').textContent === '13'`, 'chart uses actual API values')
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
    console.log('PASS admin analytics: 5 real charts, API values, UTC/unknown semantics, period/engineer URL + reload, CSV, empty/error/retry, escaped names, stale-response guard, 360px')
  } finally { await page.close() }
  for (const role of ['user', 'engineer']) {
    const page = await browser.newPage(`(${bootstrap.toString()})(${JSON.stringify(role)})`, path)
    try {
      await waitUntil(() => page.evaluate(`location.pathname !== '/admin/analytics' && window.fixture.calls.includes('/api/auth/me')`), `${role} analytics guard`)
      assert.equal(await page.evaluate(`window.fixture.calls.some(path => path.startsWith('/api/admin/analytics/'))`), false)
      console.log(`PASS ${role}: analytics route denied without analytics API calls`)
    } finally { await page.close() }
  }
} finally { await browser.close() }
