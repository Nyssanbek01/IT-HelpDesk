import 'dotenv/config'
import { setTimeout as delay } from 'node:timers/promises'
import { prisma } from '../src/db/prisma.js'
import { checkSla } from '../src/sla/check.js'

const shutdown = new AbortController()
process.once('SIGINT', () => shutdown.abort())
process.once('SIGTERM', () => shutdown.abort())

async function main() {
  do {
    try { console.log('SLA check:', await checkSla()) }
    catch { console.error('SLA check failed; the next cycle will retry safely.'); if (process.argv.includes('--once')) process.exitCode = 1 }
    if (process.argv.includes('--once') || shutdown.signal.aborted) break
    await delay(60_000, undefined, { signal: shutdown.signal }).catch(() => {})
  } while (!shutdown.signal.aborted)
}
main().finally(async () => { await prisma.$disconnect() })
