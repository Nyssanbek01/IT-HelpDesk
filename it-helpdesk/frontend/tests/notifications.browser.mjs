import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { startBrowser, waitUntil } from './browser-harness.mjs'

function bootstrap(role) {
  const user = { id: 1, name: 'Notification Browser', email: 'browser@example.invalid', role }
  localStorage.setItem('it-helpdesk.token', 'notification-test-token')
  localStorage.setItem('it-helpdesk.user', JSON.stringify(user))
  const nativeTimeout = window.setTimeout.bind(window)
  window.setTimeout = (callback, milliseconds, ...args) => nativeTimeout(callback, milliseconds === 30000 ? 180 : milliseconds, ...args)
  const ticket = { id: 1, title: 'Browser fixture', description: 'Test', status: 'new', priority: 'medium', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', userId: 1, assignedEngineerId: null, assignedEngineer: null, user }
  const item = (id, available = true) => ({ id, type: 'new_comment', title: 'Новый комментарий', message: `Событие #${id}`, ticketId: available ? 2 : null, ticketAvailable: available, isRead: false, createdAt: ticket.createdAt, readAt: null })
  const persistenceKey = `notification-fixture-${role}`
  const saved = localStorage.getItem(persistenceKey)
  window.fixture = { items: saved ? JSON.parse(saved) : [item(1), item(2, false)], calls: [], inFlight: 0, maximum: 0, fail: '', ticketFail: false, next: 3 }
  window.fetch = async (url, options = {}) => {
    const path = String(url)
    const method = options.method ?? 'GET'
    const fixture = window.fixture
    if (!path.startsWith('/api/')) throw new Error('Unexpected network request')
    if (options.headers?.Authorization !== 'Bearer notification-test-token') throw new Error('Missing bearer token')
    fixture.calls.push({ path, method })
    if (path.startsWith('/api/notifications')) {
      fixture.inFlight++
      fixture.maximum = Math.max(fixture.maximum, fixture.inFlight)
      try {
        await new Promise((resolve) => nativeTimeout(resolve, 15))
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        if (fixture.fail) return new Response('failure', { status: Number(fixture.fail) })
        if (method === 'PATCH') {
          const id = Number(path.split('/')[3])
          fixture.items = fixture.items.map((entry) => path.endsWith('read-all') || entry.id === id ? { ...entry, isRead: true, readAt: ticket.createdAt } : entry)
          localStorage.setItem(persistenceKey, JSON.stringify(fixture.items))
          return Response.json({ updated: 1 })
        }
        if (path.endsWith('/unread-count')) return Response.json({ count: fixture.items.filter((entry) => !entry.isRead).length })
        const page = Number(new URL(path, location.origin).searchParams.get('page'))
        return Response.json({ items: fixture.items.slice((page - 1) * 10, page * 10), totalPages: Math.ceil(fixture.items.length / 10) })
      } finally { fixture.inFlight-- }
    }
    if (path === '/api/auth/me') return Response.json(user)
    if (path === '/api/admin/engineers') return Response.json([])
    if (path.endsWith('/attachments') || path.endsWith('/history')) return Response.json([])
    if (path.endsWith('/comments')) {
      if (method === 'POST') {
        fixture.items.push(item(fixture.next++))
        return Response.json({ id: 1, ticketId: 1, message: 'Browser comment', createdAt: ticket.createdAt, user }, { status: 201 })
      }
      return Response.json([])
    }
    if (fixture.ticketFail && path.endsWith('/2')) return new Response(null, { status: 404 })
    return Response.json({ ...ticket, id: Number(path.split('/').pop()) })
  }
}

const browser = await startBrowser()
try {
  for (const role of ['user', 'engineer', 'admin']) {
    const path = role === 'user' ? '/tickets/1' : `/${role}/tickets/1`
    const page = await browser.newPage(`(${bootstrap.toString()})(${JSON.stringify(role)})`, path)
    const evaluate = page.evaluate
    const visible = async (expression, label) => {
      try { await waitUntil(() => evaluate(expression), `${role}: ${label}`) }
      catch (error) {
        console.log(await evaluate(`JSON.stringify({ path: location.pathname, focused: document.activeElement?.outerHTML, panel: document.querySelector('.notification-dropdown')?.textContent, recentCalls: window.fixture.calls.slice(-8) })`))
        throw error
      }
    }
    try {
      await visible(`document.querySelector('.notification-trigger')?.getAttribute('aria-label').includes('2 непрочитанных')`, 'initial count')
      await visible(`document.querySelector('textarea[id^=comment]') !== null`, 'ticket loaded')
      const start = await evaluate(`window.fixture.calls.filter(call => call.path === '/api/notifications/unread-count').length`)
      await visible(`window.fixture.calls.filter(call => call.path === '/api/notifications/unread-count').length > ${start}`, 'polling')
      await evaluate(`document.querySelector('.notification-trigger').focus()`)
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await visible(`document.querySelectorAll('.notification-item').length === 2 && !document.querySelector('.notification-dropdown').getAttribute('aria-busy').includes('true')`, 'open panel')
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'Закрыть уведомления')
      await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true })
      assert.equal(await evaluate(`document.querySelector('.notification-dropdown').getBoundingClientRect().left >= 0 && document.querySelector('.notification-dropdown').getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth <= innerWidth`), true)
      await evaluate(`document.querySelector('.notification-item-footer button').click()`)
      await visible(`document.querySelectorAll('.notification-item--unread').length === 1`, 'mark one read')
      await evaluate(`document.querySelector('.notification-toolbar button').click()`)
      await visible(`document.querySelectorAll('.notification-item--unread').length === 0 && document.querySelector('.notification-trigger').getAttribute('aria-label').includes('0 непрочитанных')`, 'read all')
      await page.send('Page.reload')
      await visible(`document.querySelector('.notification-trigger')?.getAttribute('aria-label').includes('0 непрочитанных')`, 'read status survives reload')
      await evaluate(`document.querySelector('.notification-trigger').click()`)
      await visible(`document.querySelectorAll('.notification-item').length === 2`, 'reopen')
      await evaluate(`document.querySelectorAll('.notification-link')[1].click()`)
      await visible(`document.querySelector('.notification-notice')?.textContent.includes('нет доступа')`, 'deleted ticket message')
      assert.equal(await evaluate(`location.pathname`), path)
      await visible(`!document.querySelector('.notification-link').disabled`, 'unavailable click completed')
      await evaluate(`window.fixture.ticketFail = true; document.querySelector('.notification-link').click()`)
      await visible(`window.fixture.calls.some(call => call.path.endsWith('/tickets/2'))`, 'preflight access request')
      await visible(`document.querySelector('.notification-notice')?.textContent.includes('нет доступа')`, 'revoked access')
      assert.equal(await evaluate(`location.pathname`), path)
      await visible(`!document.querySelector('.notification-link').disabled`, 'denied click completed')
      await evaluate(`window.fixture.ticketFail = false; document.querySelector('.notification-link').click()`)
      const target = role === 'user' ? '/tickets/2' : `/${role}/tickets/2`
      await visible(`location.pathname === ${JSON.stringify(target)} && !document.querySelector('.notification-dropdown')`, 'role-specific navigation')
      await evaluate(`document.querySelector('.notification-trigger').click()`)
      await visible(`document.querySelectorAll('.notification-item').length === 2`, 'keyboard panel')
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await visible(`!document.querySelector('.notification-dropdown') && document.activeElement.classList.contains('notification-trigger')`, 'Escape and restored focus')
      await visible(`document.querySelector('.comment-form textarea') !== null`, 'comment form')
      await evaluate(`(() => { const input = document.querySelector('.comment-form textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Test comment'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
      await visible(`!document.querySelector('.comment-form button[type=submit]').disabled`, 'comment input')
      await evaluate(`document.querySelector('.comment-form button[type=submit]').click()`)
      await visible(`document.querySelector('.notification-trigger').getAttribute('aria-label').includes('1 непрочитанных')`, 'refresh after user action')
      await evaluate(`window.fixture.items = []; window.dispatchEvent(new Event('helpdesk:notifications-changed')); document.querySelector('.notification-trigger').click()`)
      await visible(`document.querySelector('.notification-state')?.textContent.includes('пока нет')`, 'empty state')
      await evaluate(`window.fixture.fail = '500'; window.dispatchEvent(new Event('helpdesk:notifications-changed'))`)
      await visible(`document.querySelector('.notification-dropdown [role=alert]') !== null`, 'error state')
      await evaluate(`window.fixture.fail = ''; document.querySelector('.notification-dropdown .activity-error button').click()`)
      await visible(`!document.querySelector('.notification-dropdown [role=alert]') && document.querySelector('.notification-state')?.textContent.includes('пока нет')`, 'retry')
      assert.equal(await evaluate(`window.fixture.maximum`), 1)
      await evaluate(`document.querySelector('.topbar-logout').click()`)
      await visible(`location.pathname === '/login'`, 'logout')
      await delay(100)
      const afterLogout = await evaluate(`window.fixture.calls.filter(call => call.path.startsWith('/api/notifications')).length`)
      await delay(450)
      assert.equal(await evaluate(`window.fixture.calls.filter(call => call.path.startsWith('/api/notifications')).length`), afterLogout)
      console.log(`PASS ${role}: badge, polling, refresh on action, read/read-all, role route, revoked/deleted access, 360px, keyboard/Escape, empty/error/retry, serialized requests, logout stops polling`)
    } finally { await page.close() }
  }
} finally { await browser.close() }
