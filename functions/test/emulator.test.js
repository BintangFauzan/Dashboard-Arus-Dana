const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { Timestamp, getFirestore } = require('firebase-admin/firestore');
const { reconcileAccessExpiry } = require('../index');

const projectId = process.env.GCLOUD_PROJECT || 'demo-arus-dana';
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`;
const authBase = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const app = initializeApp({ projectId }, 'access-test-emulator');
const auth = getAuth(app);
const db = getFirestore(app);
const functionsEnvPath = path.join(__dirname, '..', '.env');
const functionsEnv = fs.existsSync(functionsEnvPath)
  ? fs.readFileSync(functionsEnvPath, 'utf8')
  : '';
const adminUid = process.env.ADMIN_UID
  || functionsEnv.match(/^ADMIN_UID=(.+)$/m)?.[1]?.trim();
let cleanup = [];

async function createSignedInUser(uid) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `qa-${suffix}@example.test`;
  const password = 'LocalEmulatorOnly-1234';
  const user = await auth.createUser({ email, password, ...(uid ? { uid } : {}) });
  cleanup.push(() => auth.deleteUser(user.uid));

  const response = await fetch(`${authBase}/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return { uid: user.uid, idToken: body.idToken };
}

async function callFunction(name, idToken, data = {}) {
  const response = await fetch(`${functionsBase}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.result ?? body.data;
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('Scheduled access reconciliation did not complete.');
}

test.after(async () => {
  for (const action of cleanup.reverse()) await action();
  const activities = await db.collection('adminActivity').get();
  await Promise.all(activities.docs.map((document) => document.ref.delete()));
  await deleteApp(app);
});

test('callable protects unlimited access and scheduled reconciliation expires trial and campaign access', {
  timeout: 30_000,
}, async () => {
  assert.ok(adminUid, 'Set ADMIN_UID for the Functions emulator test.');
  const account = await createSignedInUser();
  const campaignAccount = await createSignedInUser();
  const adminAccount = await createSignedInUser(adminUid);
  const policyRef = db.doc('config/trialPolicy');
  const accessRef = db.doc(`access/${account.uid}`);
  const campaignAccessRef = db.doc(`access/${campaignAccount.uid}`);
  const accessPolicyRef = db.doc('config/accessPolicy');
  const campaignRef = db.collection('accessCampaigns').doc(`qa-campaign-${campaignAccount.uid}`);
  const adminRequestId = `qa-admin-auth-${account.uid}`;
  cleanup.push(
    () => accessRef.delete(),
    () => campaignAccessRef.delete(),
    () => campaignRef.delete(),
    () => policyRef.delete(),
    () => accessPolicyRef.delete(),
    () => db.doc(`adminMutationRequests/${adminAccount.uid}_${adminRequestId}`).delete(),
  );

  await assert.rejects(callFunction('updateTrialPolicy', account.idToken, {
    requestId: `qa-unauthorized-${account.uid}`,
    enabled: false,
    durationDays: 7,
  }), /PERMISSION_DENIED/);
  assert.deepEqual(await callFunction('updateTrialPolicy', adminAccount.idToken, {
    requestId: adminRequestId,
    enabled: false,
    durationDays: 7,
  }), { ok: true });

  await Promise.all([
    policyRef.set({ enabled: true, durationDays: 7 }),
    accessPolicyRef.set({ defaultStatus: 'inactive' }),
    accessRef.set({ effectiveStatus: 'unlimited', source: 'default_policy' }),
  ]);
  const trialResult = await callFunction('startTrialOnFirstAiAccess', account.idToken);
  assert.deepEqual(trialResult, { started: false, reason: 'access-already-granted' });
  assert.deepEqual((await accessRef.get()).data(), {
    effectiveStatus: 'unlimited',
    source: 'default_policy',
  });

  const past = Timestamp.fromMillis(Date.now() - 60_000);
  await accessRef.set({
    effectiveStatus: 'free_tier',
    source: 'trial',
    trialStartedAt: past,
    trialEndsAt: past,
  });
  await campaignAccessRef.set({
    effectiveStatus: 'date_limited_free',
    source: 'campaign',
    campaignId: campaignRef.id,
    accessEndsAt: past,
  });
  await campaignRef.set({
    name: 'QA campaign',
    target: 'selected_users',
    uids: [campaignAccount.uid],
    startAt: past,
    endAtExclusive: past,
    postExpiryStatus: 'free_tier',
    enabled: true,
    status: 'active',
    accessReconciledAt: null,
  });

  await reconcileAccessExpiry.run();
  await waitFor(async () => {
    const trialAccess = (await accessRef.get()).data();
    const campaignAccess = (await campaignAccessRef.get()).data();
    const campaign = (await campaignRef.get()).data();
    return trialAccess?.source === 'default_policy'
      && campaignAccess?.source === 'campaign_expired'
      && campaign?.status === 'expired';
  });

  const reconciledTrial = (await accessRef.get()).data();
  const reconciledCampaignAccess = (await campaignAccessRef.get()).data();
  assert.equal(reconciledTrial.effectiveStatus, 'inactive');
  assert.equal(reconciledTrial.source, 'default_policy');
  assert.equal(reconciledTrial.trialEndsAt, undefined);
  assert.equal(reconciledCampaignAccess.effectiveStatus, 'free_tier');
  assert.equal(reconciledCampaignAccess.source, 'campaign_expired');
  assert.equal(reconciledCampaignAccess.campaignId, undefined);
  assert.equal((await campaignRef.get()).data().enabled, false);
});
