const eligibleSources = new Set([undefined, null, 'default_policy', 'campaign_expired']);
const eligibleStatuses = new Set([undefined, null, 'free_tier', 'inactive']);
const protectedCampaignSources = new Set(['manual_override', 'payment_active']);
const protectedStatuses = new Set(['unlimited', 'active']);

function getTrialStartBlockReason(access) {
  if (access.trialStartedAt) return 'trial-already-used';
  if (!eligibleSources.has(access.source) || !eligibleStatuses.has(access.effectiveStatus)) {
    return 'access-already-granted';
  }
  return null;
}

function canCampaignGrantAccess(access, nowMillis, campaignId) {
  if (protectedCampaignSources.has(access.source) || protectedStatuses.has(access.effectiveStatus)) {
    return false;
  }
  if (access.source === 'campaign') {
    return access.campaignId === campaignId;
  }
  if (access.source === 'trial') return access.trialEndsAt?.toMillis?.() <= nowMillis;
  return true;
}

module.exports = { canCampaignGrantAccess, getTrialStartBlockReason };
