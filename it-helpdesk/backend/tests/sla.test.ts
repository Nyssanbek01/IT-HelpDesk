import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deadlines, slaStatistics, ticketSla, type SlaTicket } from '../src/sla/service.js'

const start = new Date('2035-01-01T00:00:00Z')
function ticket(overrides: Partial<SlaTicket> = {}): SlaTicket {
  return { priority: 'high', status: 'new', createdAt: start, ...deadlines('high', start), firstRespondedAt: null, resolvedAt: null, slaTrackedFromCreation: true, ...overrides }
}
test('SLA: priorities, UTC arithmetic and threshold boundaries use controlled time', () => {
  for (const [priority, response, resolution] of [['high', 15, 240], ['medium', 60, 480], ['low', 240, 1440]] as const) {
    const dates = deadlines(priority, start)
    assert.equal(dates.responseDueAt!.getTime() - start.getTime(), response * 60_000)
    assert.equal(dates.resolutionDueAt!.getTime() - start.getTime(), resolution * 60_000)
  }
  assert.deepEqual(deadlines('high', new Date('2035-01-01T05:00:00+05:00')), deadlines('high', start))
  assert.equal(ticketSla(ticket(), new Date(+start + 10 * 60_000 - 1)).response.status, 'on_time')
  assert.equal(ticketSla(ticket(), new Date(+start + 10 * 60_000)).response.status, 'approaching_deadline')
  assert.equal(ticketSla(ticket(), new Date(+start + 15 * 60_000 - 1)).response.status, 'approaching_deadline')
  assert.equal(ticketSla(ticket(), new Date(+start + 15 * 60_000)).response.status, 'overdue')
  assert.equal(ticketSla(ticket(), new Date(+start + 192 * 60_000)).resolution.status, 'approaching_deadline')
  assert.equal(ticketSla(ticket(), new Date(+start + 240 * 60_000)).resolution.status, 'overdue')
})
test('SLA: actual timestamps freeze met/breached independently and unknown history stays unknown', () => {
  const exact = new Date(+start + 15 * 60_000)
  assert.equal(ticketSla(ticket({ firstRespondedAt: exact }), new Date('2040-01-01')).response.status, 'met')
  assert.equal(ticketSla(ticket({ firstRespondedAt: new Date(+exact + 1) })).response.status, 'breached')
  const complete = ticket({ status: 'resolved', firstRespondedAt: start, resolvedAt: new Date(+start + 240 * 60_000) })
  assert.equal(ticketSla(complete).resolution.status, 'met')
  assert.equal(ticketSla({ ...complete, resolvedAt: new Date(+complete.resolvedAt! + 1) }).resolution.status, 'breached')
  const legacy = ticketSla(ticket({ status: 'resolved', slaTrackedFromCreation: false }), new Date('2040-01-01'))
  assert.equal(legacy.response.status, 'unknown')
  assert.equal(legacy.resolution.status, 'unknown')
  assert.equal(ticketSla(ticket({ slaTrackedFromCreation: false })).response.status, 'unknown')
  assert.equal(ticketSla(ticket({ responseDueAt: null, resolutionDueAt: null })).resolution.status, 'unknown')
})
test('SLA statistics exclude unknown resolutions from compliance and count approaching tickets once', () => {
  const tickets = [ticket(), ticket({ status: 'resolved', firstRespondedAt: start, resolvedAt: start }), ticket({ status: 'resolved', resolvedAt: new Date(+start + 241 * 60_000) }), ticket({ status: 'resolved', slaTrackedFromCreation: false })]
  const stats = slaStatistics(tickets, new Date(+start + 12 * 60_000))
  assert.equal(stats.activeTickets, 1)
  assert.equal(stats.approaching, 1)
  assert.equal(stats.resolvedOnTime, 1)
  assert.equal(stats.resolvedBreached, 1)
  assert.equal(stats.unknownResolved, 1)
  assert.equal(stats.eligibleResolved, 2)
  assert.equal(stats.compliancePercent, 50)
  assert.equal(slaStatistics([]).compliancePercent, null)
})
