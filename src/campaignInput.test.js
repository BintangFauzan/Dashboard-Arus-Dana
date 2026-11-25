import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCampaignInput, findCampaignConflicts } from './campaignInput.js'

test('Jakarta day boundary and endAtExclusive', () => {
  // now = some time during 2026-01-02 Jakarta
  const input = buildCampaignInput({
    name: 'Test',
    target: 'all_users',
    startDate: '2026-01-02',
    endDate: '2026-01-02',
    postExpiryStatus: 'inactive',
  }, new Date('2026-01-01T20:00:00.000Z').getTime())

  assert.equal(input.startAt.toISOString(), '2026-01-01T17:00:00.000Z')
  assert.equal(input.endAtExclusive.toISOString(), '2026-01-02T17:00:00.000Z')
})

test('dedupe UID', () => {
  const input = buildCampaignInput({
    name: 'Test',
    target: 'selected_users',
    uids: ['  uid1  ', 'uid2', 'uid1', 'uid3  '],
    startDate: '2026-01-02',
    endDate: '2026-01-02',
    postExpiryStatus: 'inactive',
  }, new Date('2026-01-01T20:00:00.000Z').getTime())

  assert.deepEqual(input.uids, ['uid1', 'uid2', 'uid3'])
})

test('rejected inputs', () => {
  const cases = [
    () => buildCampaignInput({ name: '', target: 'all_users', startDate: '2026-01-02', endDate: '2026-01-02', postExpiryStatus: 'inactive' }, 0),
    () => buildCampaignInput({ name: 'x'.repeat(121), target: 'all_users', startDate: '2026-01-02', endDate: '2026-01-02', postExpiryStatus: 'inactive' }, 0),
    () => buildCampaignInput({ name: 'Test', target: 'invalid', startDate: '2026-01-02', endDate: '2026-01-02', postExpiryStatus: 'inactive' }, 0),
    () => buildCampaignInput({ name: 'Test', target: 'selected_users', uids: [], startDate: '2026-01-02', endDate: '2026-01-02', postExpiryStatus: 'inactive' }, 0),
    () => buildCampaignInput({ name: 'Test', target: 'selected_users', uids: 'uid1', startDate: '2026-01-02', endDate: '2026-01-02', postExpiryStatus: 'inactive' }, 0),
    () => buildCampaignInput({ name: 'Test', target: 'all_users', startDate: '2026-02-30', endDate: '2026-01-02', postExpiryStatus: 'inactive' }, 0),
    () => buildCampaignInput({ name: 'Test', target: 'all_users', startDate: '2026-01-02', endDate: '2026-01-01', postExpiryStatus: 'inactive' }, 0),
    () => buildCampaignInput({ name: 'Test', target: 'all_users', startDate: '2026-01-02', endDate: '2026-01-02', postExpiryStatus: 'invalid' }, 0),
  ]
  for (const fn of cases) {
    assert.throws(fn)
  }
})

test('conflict detection', () => {
  const input = buildCampaignInput({
    name: 'Test',
    target: 'all_users',
    startDate: '2026-01-02',
    endDate: '2026-01-02',
    postExpiryStatus: 'inactive',
  }, new Date('2026-01-01T20:00:00.000Z').getTime())

  const existing = [
    { id: 'c1', target: 'selected_users', uids: ['uid1'], startAt: new Date('2026-01-01T17:00:00.000Z'), endAtExclusive: new Date('2026-01-03T17:00:00.000Z'), status: 'active', enabled: true },
    { id: 'c2', target: 'all_users', startAt: new Date('2026-01-10T17:00:00.000Z'), endAtExclusive: new Date('2026-01-11T17:00:00.000Z'), status: 'ended', enabled: true },
  ]

  const conflicts = findCampaignConflicts(input, existing)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].id, 'c1')

  const noConflict = findCampaignConflicts(input, [
    { id: 'c3', target: 'selected_users', uids: ['uid2'], startAt: new Date('2026-01-02T17:00:00.000Z'), endAtExclusive: new Date('2026-01-03T17:00:00.000Z'), status: 'active', enabled: true },
  ])
  assert.equal(noConflict.length, 0)
})