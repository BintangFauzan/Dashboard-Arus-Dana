import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getCampaignStatus,
  toJakartaDateInput,
  toJakartaInclusiveEndInput,
} from './campaignUtils.js'

test('campaign status respects the exclusive end instant and current pause state', () => {
  const campaign = {
    startAt: new Date('2026-01-01T17:00:00.000Z'),
    endAtExclusive: new Date('2026-01-02T17:00:00.000Z'),
    enabled: true,
    status: 'active',
  }

  assert.equal(getCampaignStatus(campaign, Date.parse('2026-01-01T16:59:59.999Z')), 'scheduled')
  assert.equal(getCampaignStatus(campaign, Date.parse('2026-01-01T17:00:00.000Z')), 'active')
  assert.equal(getCampaignStatus(campaign, Date.parse('2026-01-02T17:00:00.000Z')), 'expired')
  assert.equal(getCampaignStatus({ ...campaign, enabled: false }, Date.parse('2026-01-02T00:00:00.000Z')), 'paused')
});

test('date input conversion uses Asia/Jakarta and inclusive campaign end dates', () => {
  assert.equal(toJakartaDateInput(new Date('2026-01-01T17:00:00.000Z')), '2026-01-02')
  assert.equal(toJakartaInclusiveEndInput(new Date('2026-01-01T17:00:00.000Z')), '2026-01-01')
  assert.equal(toJakartaDateInput('not-a-date'), '')
})
