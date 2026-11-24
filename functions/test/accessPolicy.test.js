const test = require('node:test');
const assert = require('node:assert/strict');
const { canCampaignGrantAccess, getTrialStartBlockReason } = require('../accessPolicy');

test('allows trial only for default or expired campaign access with a free baseline', () => {
  assert.equal(getTrialStartBlockReason({ source: 'default_policy', effectiveStatus: 'free_tier' }), null);
  assert.equal(getTrialStartBlockReason({ source: 'campaign_expired', effectiveStatus: 'inactive' }), null);
  assert.equal(getTrialStartBlockReason({}), null);
});

test('does not downgrade unlimited, active, campaign, or manual override access', () => {
  for (const access of [
    { source: 'default_policy', effectiveStatus: 'unlimited' },
    { source: 'payment_active', effectiveStatus: 'active' },
    { source: 'campaign', effectiveStatus: 'date_limited_free' },
    { source: 'manual_override', effectiveStatus: 'free_tier' },
  ]) {
    assert.equal(getTrialStartBlockReason(access), 'access-already-granted');
  }
});

test('does not restart a previously used trial', () => {
  assert.equal(
    getTrialStartBlockReason({ trialStartedAt: new Date(), source: 'campaign_expired' }),
    'trial-already-used',
  );
});

test('campaigns preserve higher access and unexpired trials', () => {
  const future = { toMillis: () => 2000 };
  assert.equal(canCampaignGrantAccess({ source: 'manual_override' }, 1000), false);
  assert.equal(canCampaignGrantAccess({ effectiveStatus: 'unlimited' }, 1000), false);
  assert.equal(canCampaignGrantAccess({ source: 'trial', trialEndsAt: future }, 1000, 'c1'), false);
  assert.equal(canCampaignGrantAccess({ source: 'trial', trialEndsAt: future }, 2000, 'c1'), true);
  assert.equal(canCampaignGrantAccess({ source: 'campaign', campaignId: 'c2' }, 1000, 'c1'), false);
  assert.equal(canCampaignGrantAccess({ effectiveStatus: 'inactive' }, 1000, 'c1'), true);
});
