// Runs the production frontend in Chromium with mocked API responses.
// No requests or mutations reach the real backend or database.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(frontend, 'dist')
const profile = await mkdtemp(join(tmpdir(), 'helpdesk-browser-step9-'))
const browserPath = process.env.HELPDESK_TEST_BROWSER ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const server = createServer(async (request, response) => {
  try {
    if (request.url.startsWith('/api/')) { response.writeHead(500); response.end('Unexpected real API request'); return }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let target = resolve(dist, `.${pathname}`)
    if (!target.startsWith(`${dist}${sep}`)) target = join(dist, 'index.html')
    let data
    try { data = await readFile(target) } catch { target = join(dist, 'index.html'); data = await readFile(target) }
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(target)] ?? 'application/octet-stream')
    response.end(data)
  } catch { response.writeHead(500); response.end() }
})
server.listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let browserError
browser.on('error', (error) => { browserError = error })

async function waitUntil(callback, message, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (browserError) throw browserError
    if (await callback()) return
    await delay(25)
  }
  throw new Error(`Timeout: ${message}`)
}

let debugOrigin
async function connect() {
  const page = await (await fetch(`${debugOrigin}/json/new?about:blank`, { method: 'PUT' })).json()
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let serial = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serial
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  return { send, evaluate, close: async () => { socket.close(); await fetch(`${debugOrigin}/json/close/${page.id}`) } }
}

function bootstrap(role) {
  const user = { id: 1, name: 'Browser Test', email: 'browser@example.invalid', role }
  localStorage.setItem('it-helpdesk.token', 'browser-test-token')
  localStorage.setItem('it-helpdesk.user', JSON.stringify(user))
  const ticket = { id: 1, title: 'Browser fixture', description: 'Test attachment UI', status: 'new', priority: 'medium', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', userId: 1, assignedEngineerId: null, assignedEngineer: null, user }
  const item = (id, owner, name) => ({ id, ticketId: 1, originalName: name, mimeType: 'text/plain', sizeBytes: 12, createdAt: ticket.createdAt, uploadedBy: { id: owner, name: 'Fixture Author', role: 'user' } })
  window.fixture = { items: [item(1, 1, 'own.txt'), item(2, 2, 'other.txt')], requests: [], history: [], downloads: [], nextId: 3, confirm: false, fail: '', listFailure: true }
  window.confirm = () => window.fixture.confirm
  const originalClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.fixture.downloads.push({ name: this.download, href: this.href }); return }
    originalClick.call(this)
  }
  window.fetch = async (url, options = {}) => {
    const path = String(url)
    const method = options.method ?? 'GET'
    const fixture = window.fixture
    if (!path.startsWith('/api/')) throw new Error('Unexpected network request')
    if (options.headers?.Authorization !== 'Bearer browser-test-token') throw new Error('Missing bearer authorization')
    fixture.requests.push({ path, method })
    if (path === '/api/notifications/unread-count') return Response.json({ count: 0 })
    if (path.startsWith('/api/notifications?')) return Response.json({ items: [], totalPages: 0 })
    if (path === '/api/auth/me') return Response.json(user)
    if (path === '/api/admin/engineers') return Response.json([])
    if (path.endsWith('/comments')) return Response.json([])
    if (path.endsWith('/history')) return Response.json(fixture.history)
    if (!path.includes('/attachments')) return Response.json(ticket)
    if (fixture.fail) return Response.json({ message: 'simulated failure' }, { status: Number(fixture.fail) })
    if (path.endsWith('/download')) return new Response('fixture data', { headers: { 'Content-Type': 'text/plain' } })
    if (method === 'POST') {
      const entries = [...options.body.entries()]
      if (entries.length !== 1 || entries[0][0] !== 'file' || options.headers['Content-Type']) throw new Error('Incorrect multipart upload')
      const file = entries[0][1]
      const added = item(fixture.nextId++, 1, file.name)
      added.sizeBytes = file.size
      fixture.items.push(added)
      fixture.history.push({ id: fixture.history.length + 1, ticketId: 1, actorId: 1, action: 'attachment_added', oldValue: null, newValue: file.name, createdAt: ticket.createdAt, actor: user })
      return Response.json(added, { status: 201 })
    }
    if (method === 'DELETE') {
      const id = Number(path.split('/').pop())
      const removed = fixture.items.find((entry) => entry.id === id)
      fixture.items = fixture.items.filter((entry) => entry.id !== id)
      fixture.history.push({ id: fixture.history.length + 1, ticketId: 1, actorId: 1, action: 'attachment_deleted', oldValue: removed.originalName, newValue: null, createdAt: ticket.createdAt, actor: user })
      return new Response(null, { status: 204 })
    }
    if (fixture.listFailure) { fixture.listFailure = false; return new Response('offline', { status: 500 }) }
    return Response.json(fixture.items)
  }
}

try {
  await waitUntil(async () => {
    try { const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n'); debugOrigin = `http://127.0.0.1:${port}`; return true } catch { return false }
  }, 'browser startup')
  for (const role of ['user', 'engineer', 'admin']) {
    const page = await connect()
    try {
      await page.send('Page.enable')
      await page.send('Runtime.enable')
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${bootstrap.toString()})(${JSON.stringify(role)})` })
      const path = role === 'user' ? '/tickets/1' : `/${role}/tickets/1`
      await page.send('Page.navigate', { url: `${origin}${path}` })
      const evaluate = page.evaluate
      await waitUntil(() => evaluate(`Boolean(document.querySelector('.attachments-panel .activity-error button'))`), `${role} list error`)
      assert.equal(await evaluate(`document.querySelector('.attachment-form button[type=submit]').disabled`), true)
      await evaluate(`document.querySelector('.attachments-panel .activity-error button').click()`)
      await waitUntil(() => evaluate(`document.querySelectorAll('.attachment-item').length === 2`), `${role} list`)
      assert.equal(await evaluate(`document.querySelectorAll('.attachment-actions .danger-button').length`), role === 'admin' ? 2 : 1)
      await evaluate(`document.querySelector('[aria-label="Скачать other.txt"]').click()`)
      await waitUntil(() => evaluate(`window.fixture.downloads.length === 1`), `${role} download`)
      assert.equal(await evaluate(`window.fixture.downloads[0].name`), 'other.txt')
      assert.ok((await evaluate(`window.fixture.downloads[0].href`)).startsWith('blob:'))
      await waitUntil(() => evaluate(`!document.querySelector('.attachment-actions button').disabled`), 'download completed')
      await evaluate(`document.querySelector('[aria-label="Удалить own.txt"]').click()`)
      assert.equal(await evaluate(`window.fixture.requests.filter(r => r.method === 'DELETE').length`), 0)
      await evaluate(`window.fixture.confirm = true; document.querySelector('[aria-label="Удалить own.txt"]').click()`)
      await waitUntil(() => evaluate(`document.querySelectorAll('.attachment-item').length === 1 && document.querySelector('.history-list')?.textContent.includes('Удалено вложение')`), `${role} deletion and history`)
      await evaluate(`(() => { const input = document.querySelector('input[type=file]'); const data = new DataTransfer(); data.items.add(new File(['test'], 'invalid.exe')); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`)
      await waitUntil(() => evaluate(`document.querySelector('.attachment-form [role=alert]')?.textContent.includes('Допустимы')`), 'invalid extension')
      assert.equal(await evaluate(`document.querySelector('.attachment-form button[type=submit]').disabled`), true)
      await evaluate(`(() => { const input = document.querySelector('input[type=file]'); const data = new DataTransfer(); data.items.add(new File(['browser upload'], 'uploaded.txt', { type: 'text/plain' })); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`)
      await waitUntil(() => evaluate(`!document.querySelector('.attachment-form button[type=submit]').disabled`), 'valid file')
      await evaluate(`document.querySelector('.attachment-form').requestSubmit(); document.querySelector('.attachment-form').requestSubmit()`)
      await waitUntil(() => evaluate(`document.querySelector('[aria-label="Скачать uploaded.txt"]') && document.querySelector('.history-list')?.textContent.includes('Добавлено вложение')`), `${role} upload and history`)
      assert.equal(await evaluate(`window.fixture.requests.filter(r => r.method === 'POST').length`), 1)
      assert.equal(await evaluate(`document.querySelector('input[type=file]').value`), '')
      if (role === 'admin') {
        await evaluate(`document.querySelector('[aria-label="Удалить other.txt"]').click()`)
        await waitUntil(() => evaluate(`!document.querySelector('[aria-label="Скачать other.txt"]')`), 'admin deletes other uploader file')
      }
      await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
      assert.equal(await evaluate(`document.querySelector('.attachments-panel').getBoundingClientRect().right <= innerWidth + 1`), true)
      await evaluate(`window.fixture.fail = '403'; document.querySelector('[aria-label="Удалить uploaded.txt"]').click()`)
      await waitUntil(() => evaluate(`document.querySelector('.attachment-form [role=alert]')?.textContent.includes('прав')`), '403 error')
      await waitUntil(() => evaluate(`Boolean(document.querySelector('.attachments-panel .activity-error button'))`), 'failed mutation reconciliation')
      await evaluate(`window.fixture.fail = ''; window.fixture.items = Array.from({ length: 10 }, (_, i) => ({ ...window.fixture.items[0], id: 100 + i, originalName: 'limit-' + i + '.txt' })); document.querySelector('.attachments-panel .activity-error button').click()`)
      await waitUntil(() => evaluate(`document.querySelectorAll('.attachment-item').length === 10`), 'limit reload')
      assert.equal(await evaluate(`document.querySelector('input[type=file]').disabled`), true)
      await evaluate(`window.fixture.fail = '401'; document.querySelector('.attachment-actions .secondary-button').click()`)
      await waitUntil(() => evaluate(`location.pathname === '/login'`), 'expired session redirect')
      assert.equal(await evaluate(`localStorage.getItem('it-helpdesk.token')`), null)
      console.log(`PASS ${role}: list, permissions, download, confirmation, upload, history, mobile layout, 403, 10-file limit, 401`)
    } finally { await page.close() }
  }
} finally {
  browser.kill()
  await new Promise((resolve) => { if (browser.exitCode !== null) resolve(); else browser.once('exit', resolve) })
  await new Promise((resolve) => server.close(resolve))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
