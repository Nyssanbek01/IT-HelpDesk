import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

export async function waitUntil(callback, message, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await callback()) return; await delay(25) }
  throw new Error(`Timeout: ${message}`)
}

export async function startBrowser() {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
  const profile = await mkdtemp(join(tmpdir(), 'helpdesk-browser-step10-'))
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
  const browser = spawn(process.env.HELPDESK_TEST_BROWSER ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let browserError
  browser.on('error', (error) => { browserError = error })
  async function close() {
    browser.kill()
    if (browser.exitCode === null && !browserError) await new Promise((resolve) => browser.once('exit', resolve))
    await new Promise((resolve) => server.close(resolve))
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  let debugOrigin
  try {
    await waitUntil(async () => {
      if (browserError) throw browserError
      try { const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n'); debugOrigin = `http://127.0.0.1:${port}`; return true } catch { return false }
    }, 'browser startup')
  } catch (error) { await close(); throw error }
  async function newPage(source, path) {
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
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result)
    })
    function send(method, params = {}) {
      return new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
    }
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Page.bringToFront')
    await send('Page.addScriptToEvaluateOnNewDocument', { source })
    await send('Page.navigate', { url: `${origin}${path}` })
    return { send, evaluate, close: async () => { socket.close(); await fetch(`${debugOrigin}/json/close/${page.id}`) } }
  }
  return { origin, newPage, close }
}
