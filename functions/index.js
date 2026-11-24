const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore');
const functions = require('firebase-functions');
const cors = require('cors')({ origin: true });
const { canCampaignGrantAccess, getTrialStartBlockReason } = require('./accessPolicy');
const { randomUUID } = require('node:crypto');

initializeApp();
const db = getFirestore();
const adminAuth = getAuth();
const RECONCILIATION_PAGE_SIZE = 200;

const HTTP_STATUS = {
  ok: 200,
  'invalid-argument': 400,
  'failed-precondition': 400,
  'out-of-range': 400,
  'not-found': 404,
  'already-exists': 409,
  'aborted': 409,
  'permission-denied': 403,
  'unauthenticated': 401,
  'resource-exhausted': 429,
  'unimplemented': 501,
  'internal': 500,
  'unavailable': 503,
  'data-loss': 500,
  'unknown': 500,
  'cancelled': 499,
  'deadline-exceeded': 504,
};

function sendJson(response, statusCode, body) {
  response.setHeader('Content-Type', 'application/json');
  response.status(statusCode).json(body);
}

function handleError(response, error) {
  const statusCode = HTTP_STATUS[error.code] || 500;
  sendJson(response, statusCode, { error: error.message || 'Internal server error' });
}

async function verifyBearerToken(request) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const error = new Error('Login diperlukan.');
    error.code = 'unauthenticated';
    throw error;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded;
  } catch {
    const authError = new Error('Token tidak valid.');
    authError.code = 'unauthenticated';
    throw authError;
  }
}

function requireAdminUid(uid) {
  if (!process.env.ADMIN_UID || uid !== process.env.ADMIN_UID) {
    const error = new Error('Akses admin diperlukan.');
    error.code = 'permission-denied';
    throw error;
  }
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const error = new Error(`${name} wajib diisi.`);
    error.code = 'invalid-argument';
    throw error;
  }
  return value.trim();
}

function requireDocumentId(value, name) {
  const id = requireString(value, name);
  if (id.length > 128 || id.includes('/') || id === '.' || id === '..') {
    const error = new Error(`${name} tidak valid.`);
    error.code = 'invalid-argument';
    throw error;
  }
  return id;
}

function requireJakartaDate(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${name} harus menggunakan format YYYY-MM-DD.`);
    error.code = 'invalid-argument';
    throw error;
  }

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999) {
    const error = new Error(`${name} bukan tanggal kalender yang valid.`);
    error.code = 'invalid-argument';
    throw error;
  }
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(0, 0, 0, 0);
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) {
    const error = new Error(`${name} bukan tanggal kalender yang valid.`);
    error.code = 'invalid-argument';
    throw error;
  }

  return Timestamp.fromDate(new Date(`${value}T00:00:00+07:00`));
}

function getCampaignInput(data) {
  const name = requireString(data?.name, 'Nama kampanye');
  if (name.length > 120) {
    const error = new Error('Nama kampanye maksimal 120 karakter.');
    error.code = 'invalid-argument';
    throw error;
  }

  const target = requireString(data?.target, 'Target kampanye');
  if (!['all_users', 'selected_users'].includes(target)) {
    const error = new Error('Target kampanye tidak valid.');
    error.code = 'invalid-argument';
    throw error;
  }

  if (target === 'selected_users' && !Array.isArray(data?.uids)) {
    const error = new Error('Daftar UID target tidak valid.');
    error.code = 'invalid-argument';
    throw error;
  }

  const uids = target === 'selected_users'
    ? [...new Set(data.uids.map((uid) => {
      if (typeof uid !== 'string' || uid.trim().length === 0 || uid.trim().length > 128) {
        const error = new Error('Setiap UID target harus berupa teks yang valid.');
        error.code = 'invalid-argument';
        throw error;
      }
      return uid.trim();
    }))] : [];
  if (target === 'selected_users' && (uids.length === 0 || uids.length > 500)) {
    const error = new Error('Pilih 1–500 UID untuk target tertentu.');
    error.code = 'invalid-argument';
    throw error;
  }

  const startAt = requireJakartaDate(data?.startDate, 'Tanggal mulai');
  const endDate = requireJakartaDate(data?.endDate, 'Tanggal akhir');
  if (endDate.toMillis() < startAt.toMillis()) {
    const error = new Error('Tanggal akhir harus setelah atau sama dengan tanggal mulai.');
    error.code = 'invalid-argument';
    throw error;
  }

  const endAtExclusive = Timestamp.fromMillis(endDate.toMillis() + 24 * 60 * 60 * 1000);
  if (endAtExclusive.toMillis() <= Timestamp.now().toMillis()) {
    const error = new Error('Tanggal akhir kampanye harus berada di masa depan.');
    error.code = 'invalid-argument';
    throw error;
  }
  const postExpiryStatus = requireString(data?.postExpiryStatus, 'Status setelah kampanye');
  if (!['inactive', 'free_tier', 'unlimited'].includes(postExpiryStatus)) {
    const error = new Error('Status setelah kampanye tidak valid.');
    error.code = 'invalid-argument';
    throw error;
  }

  return { name, target, uids, startAt, endAtExclusive, postExpiryStatus };
}

function targetsOverlap(first, second) {
  if (first.target === 'all_users' || second.target === 'all_users') return true;
  const secondUids = new Set(second.uids || []);
  return (first.uids || []).some((uid) => secondUids.has(uid));
}

async function assertNoCampaignConflict(input, excludedId = null) {
  const snapshot = await db.collection('accessCampaigns').get();
  const conflicts = snapshot.docs.filter((document) => {
    if (document.id === excludedId) return false;
    const campaign = document.data();
    if (campaign.enabled === false || ['cancelled', 'ended'].includes(campaign.status)) return false;
    if (!campaign.startAt || !campaign.endAtExclusive) return false;

    const overlapsDates = input.startAt.toMillis() < campaign.endAtExclusive.toMillis()
      && campaign.startAt.toMillis() < input.endAtExclusive.toMillis();
    return overlapsDates && targetsOverlap(input, campaign);
  });

  if (conflicts.length > 0) {
    const error = new Error(
      `Jadwal bertabrakan dengan kampanye: ${conflicts.map((item) => item.id).join(', ')}.`,
    );
    error.code = 'failed-precondition';
    throw error;
  }
}

function campaignStatus(campaign, now = Date.now()) {
  if (campaign.status === 'ended' || campaign.status === 'cancelled') return 'ended';
  const startAt = campaign.startAt?.toMillis?.();
  const endAt = campaign.endAtExclusive?.toMillis?.();
  if (typeof startAt !== 'number' || typeof endAt !== 'number') return 'invalid';
  if (now >= endAt) return 'expired';
  if (campaign.enabled === false || (campaign.enabled === undefined && campaign.status === 'paused')) return 'paused';
  if (now < startAt) return 'scheduled';
  return 'active';
}

function getAdminMutationRef(adminUid, requestId) {
  const id = requireDocumentId(requestId, 'ID permintaan');
  return db.doc(`adminMutationRequests/${adminUid}_${id}`);
}

async function getCommittedAdminMutation(adminUid, requestId) {
  const snapshot = await getAdminMutationRef(adminUid, requestId).get();
  return snapshot.exists ? snapshot.data().result : null;
}

async function commitAdminMutation(writeMutation, adminUid, type, summary, metadata, requestId, result) {
  const requestRef = getAdminMutationRef(adminUid, requestId);
  const activityRef = db.collection('adminActivity').doc();
  return db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) return requestSnapshot.data().result;
    writeMutation(transaction);
    transaction.create(activityRef, {
      adminUid,
      type,
      summary,
      metadata,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(requestRef, {
      result,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    return result;
  });
}

async function withCampaignLock(operation) {
  const lockRef = db.doc('config/campaignLock');
  const owner = randomUUID();
  const nowMillis = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const expiresAt = snapshot.data()?.expiresAt?.toMillis?.() || 0;
    if (expiresAt > nowMillis) {
      const error = new Error('Perubahan kampanye lain sedang diproses. Coba lagi.');
      error.code = 'aborted';
      throw error;
    }
    transaction.set(lockRef, {
      owner,
      expiresAt: Timestamp.fromMillis(nowMillis + 120_000),
    });
  });

  try {
    return await operation();
  } finally {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(lockRef);
      if (snapshot.data()?.owner === owner) transaction.delete(lockRef);
    });
  }
}

async function getDefaultAccessStatus() {
  const policy = await db.doc('config/accessPolicy').get();
  const status = policy.data()?.defaultStatus;
  return ['unlimited', 'free_tier', 'inactive'].includes(status) ? status : 'inactive';
}

async function applyCampaignToUid(campaignId, uid, defaultStatus) {
  const campaignRef = db.doc(`accessCampaigns/${campaignId}`);
  const accessRef = db.doc(`access/${uid}`);
  return db.runTransaction(async (transaction) => {
    const nowMillis = Date.now();
    const [campaignSnapshot, accessSnapshot] = await Promise.all([
      transaction.get(campaignRef),
      transaction.get(accessRef),
    ]);
    const activeCampaign = campaignSnapshot.data();
    if (
      !activeCampaign
      || activeCampaign.enabled !== true
      || (
        activeCampaign.target !== 'all_users'
        && !(activeCampaign.target === 'selected_users' && activeCampaign.uids?.includes(uid))
      )
      || ['ended', 'cancelled', 'expired', 'paused'].includes(activeCampaign.status)
      || activeCampaign.startAt?.toMillis?.() > nowMillis
      || activeCampaign.endAtExclusive?.toMillis?.() <= nowMillis
    ) return false;
    const existing = accessSnapshot.data() || {};

    const trialExpired = existing.source === 'trial'
      && existing.trialEndsAt?.toMillis?.() <= nowMillis;
    if (trialExpired) {
      existing.source = 'default_policy';
      existing.effectiveStatus = defaultStatus;
    }

    if (!canCampaignGrantAccess(existing, nowMillis, campaignId)) return false;
    if (existing.source === 'campaign' && existing.campaignId === campaignId) return true;

    const update = {
      effectiveStatus: 'date_limited_free',
      source: 'campaign',
      campaignId,
      accessEndsAt: activeCampaign.endAtExclusive,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (trialExpired) update.trialEndsAt = FieldValue.delete();
    transaction.set(accessRef, update, { merge: true });
    return true;
  });
}

async function reconcileCampaignAccess(campaignId, campaign) {
  const defaultStatus = await getDefaultAccessStatus();
  if (campaign.target === 'selected_users') {
    for (const uid of campaign.uids || []) {
      await applyCampaignToUid(campaignId, uid, defaultStatus);
    }
    return;
  }

  let cursor = null;
  while (true) {
    let usersQuery = db.collection('users')
      .orderBy(FieldPath.documentId())
      .limit(RECONCILIATION_PAGE_SIZE);
    if (cursor) usersQuery = usersQuery.startAfter(cursor);
    const users = await usersQuery.get();
    if (users.empty) break;

    await Promise.all(users.docs.map((user) => (
      applyCampaignToUid(campaignId, user.id, defaultStatus)
    )));
    cursor = users.docs[users.docs.length - 1];
    if (users.size < RECONCILIATION_PAGE_SIZE) break;
  }
}

async function expireCampaignAccess(campaignId, campaign) {
  const postExpiryStatus = ['inactive', 'free_tier', 'unlimited'].includes(campaign.postExpiryStatus)
    ? campaign.postExpiryStatus
    : 'inactive';
  let cursor = null;
  while (true) {
    let accessQuery = db.collection('access')
      .where('campaignId', '==', campaignId)
      .orderBy(FieldPath.documentId())
      .limit(RECONCILIATION_PAGE_SIZE);
    if (cursor) accessQuery = accessQuery.startAfter(cursor);
    const accessSnapshot = await accessQuery.get();
    if (accessSnapshot.empty) break;

    await Promise.all(accessSnapshot.docs.map((document) => db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(document.ref);
      const current = currentSnapshot.data();
      if (current?.source !== 'campaign' || current.campaignId !== campaignId) return;
      transaction.set(document.ref, {
        effectiveStatus: postExpiryStatus,
        source: 'campaign_expired',
        campaignId: FieldValue.delete(),
        accessEndsAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    })));
    cursor = accessSnapshot.docs[accessSnapshot.docs.length - 1];
    if (accessSnapshot.size < RECONCILIATION_PAGE_SIZE) break;
  }
}

async function markCampaignAccessReconciled(campaignRef, statuses) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(campaignRef);
    const campaign = snapshot.data();
    if (!campaign || !statuses.includes(campaign.status) || campaign.accessReconciledAt !== null) return;
    transaction.update(campaignRef, { accessReconciledAt: FieldValue.serverTimestamp() });
  });
}

async function reconcileExpiredTrials(now) {
  const defaultStatus = await getDefaultAccessStatus();
  let cursor = null;
  while (true) {
    let expiredQuery = db.collection('access')
      .where('source', '==', 'trial')
      .where('trialEndsAt', '<=', now)
      .orderBy('trialEndsAt')
      .limit(RECONCILIATION_PAGE_SIZE);
    if (cursor) expiredQuery = expiredQuery.startAfter(cursor);
    const snapshot = await expiredQuery.get();
    if (snapshot.empty) break;

    await Promise.all(snapshot.docs.map((document) => db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(document.ref);
      const current = currentSnapshot.data();
      if (
        current?.source !== 'trial'
        || !current.trialEndsAt
        || current.trialEndsAt.toMillis() > now.toMillis()
      ) return;
      transaction.set(document.ref, {
        effectiveStatus: defaultStatus,
        source: 'default_policy',
        trialEndsAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    })));
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < RECONCILIATION_PAGE_SIZE) break;
  }
}

async function reconcileCampaignSchedules(now) {
  let cursor = null;
  while (true) {
    let campaignQuery = db.collection('accessCampaigns')
      .where('enabled', '==', true)
      .where('status', 'in', ['scheduled', 'active'])
      .orderBy('startAt')
      .limit(RECONCILIATION_PAGE_SIZE);
    if (cursor) campaignQuery = campaignQuery.startAfter(cursor);
    const campaigns = await campaignQuery.get();
    if (campaigns.empty) break;

    for (const document of campaigns.docs) {
      const campaign = document.data();
      if (!campaign.startAt || !campaign.endAtExclusive) continue;

      if (campaign.endAtExclusive.toMillis() <= now.toMillis()) {
        await expireCampaignAccess(document.id, campaign);
        await db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(document.ref);
          const current = currentSnapshot.data();
          if (
            !current
            || current.enabled !== true
            || !['scheduled', 'active'].includes(current.status)
            || current.endAtExclusive?.toMillis?.() > now.toMillis()
          ) return;
          transaction.update(document.ref, {
            enabled: false,
            status: 'expired',
            accessReconciledAt: FieldValue.serverTimestamp(),
          });
        });
      } else if (
        campaign.startAt.toMillis() <= now.toMillis()
        && !campaign.accessReconciledAt
      ) {
        await expireCampaignAccess(document.id, campaign);
        await reconcileCampaignAccess(document.id, campaign);
        await db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(document.ref);
          const current = currentSnapshot.data();
          if (
            !current
            || current.enabled !== true
            || !['scheduled', 'active'].includes(current.status)
            || current.startAt?.toMillis?.() > now.toMillis()
            || current.endAtExclusive?.toMillis?.() <= now.toMillis()
          ) return;
          transaction.update(document.ref, {
            status: 'active',
            accessReconciledAt: FieldValue.serverTimestamp(),
          });
        });
      }
    }

    cursor = campaigns.docs[campaigns.docs.length - 1];
    if (campaigns.size < RECONCILIATION_PAGE_SIZE) break;
  }

  let cleanupCursor = null;
  while (true) {
    let cleanupQuery = db.collection('accessCampaigns')
      .where('enabled', '==', false)
      .where('accessReconciledAt', '==', null)
      .limit(RECONCILIATION_PAGE_SIZE);
    if (cleanupCursor) cleanupQuery = cleanupQuery.startAfter(cleanupCursor);
    const cleanupCampaigns = await cleanupQuery.get();
    if (cleanupCampaigns.empty) break;

    for (const document of cleanupCampaigns.docs) {
      const campaign = document.data();
      if (!['paused', 'ended', 'cancelled'].includes(campaign.status)) continue;
      await expireCampaignAccess(document.id, campaign);
      await markCampaignAccessReconciled(document.ref, [campaign.status]);
    }

    cleanupCursor = cleanupCampaigns.docs[cleanupCampaigns.docs.length - 1];
    if (cleanupCampaigns.size < RECONCILIATION_PAGE_SIZE) break;
  }
}

// ===== Background triggers (v1) =====

exports.reconcileAccessExpiry = functions.pubsub.schedule('every 1 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const now = Timestamp.now();
    await reconcileExpiredTrials(now);
    await reconcileCampaignSchedules(now);
    return null;
  });

exports.applyActiveCampaignToNewUser = functions.firestore.document('users/{uid}')
  .onCreate(async (snapshot, context) => {
    const uid = context.params.uid;
    const now = Timestamp.now();
    let cursor = null;

    while (true) {
      let activeCampaigns = db.collection('accessCampaigns')
        .where('enabled', '==', true)
        .where('status', '==', 'active')
        .orderBy(FieldPath.documentId())
        .limit(RECONCILIATION_PAGE_SIZE);
      if (cursor) activeCampaigns = activeCampaigns.startAfter(cursor);
      const snapshotResult = await activeCampaigns.get();
      if (snapshotResult.empty) break;

      await Promise.all(snapshotResult.docs.map(async (document) => {
        const campaign = document.data();
        const isActive = campaign.startAt?.toMillis?.() <= now.toMillis()
          && campaign.endAtExclusive?.toMillis?.() > now.toMillis();
        const targetsUser = campaign.target === 'all_users'
          || (campaign.target === 'selected_users' && campaign.uids?.includes(uid));
        if (isActive && targetsUser) {
          await applyCampaignToUid(
            document.id,
            uid,
            await getDefaultAccessStatus(),
          );
        }
      }));

      cursor = snapshotResult.docs[snapshotResult.docs.length - 1];
      if (snapshotResult.size < RECONCILIATION_PAGE_SIZE) break;
    }
    return null;
  });

// ===== HTTP functions (v1) =====

async function runAuthenticated(request, response, handler) {
  cors(request, response, async () => {
    try {
      const decoded = await verifyBearerToken(request);
      const data = request.body || {};
      const result = await handler(decoded, data);
      sendJson(response, 200, result);
    } catch (error) {
      handleError(response, error);
    }
  });
}

async function runAdmin(request, response, handler) {
  cors(request, response, async () => {
    try {
      const decoded = await verifyBearerToken(request);
      requireAdminUid(decoded.uid);
      const data = request.body || {};
      const result = await handler(decoded, data);
      sendJson(response, 200, result);
    } catch (error) {
      handleError(response, error);
    }
  });
}

async function runAdminMutation(request, response, handler) {
  cors(request, response, async () => {
    try {
      const decoded = await verifyBearerToken(request);
      requireAdminUid(decoded.uid);
      const data = request.body || {};
      const requestId = requireDocumentId(data?.requestId, 'ID permintaan');
      const previousResult = await getCommittedAdminMutation(decoded.uid, requestId);
      const result = await withCampaignLock(async () => {
        return handler(decoded, requestId, previousResult, data);
      });
      sendJson(response, 200, result);
    } catch (error) {
      handleError(response, error);
    }
  });
}

exports.updateAccessPolicy = functions.https.onRequest((request, response) => {
  runAdmin(request, response, async (auth, data) => {
    const requestId = requireDocumentId(data?.requestId, 'ID permintaan');
    const previousResult = await getCommittedAdminMutation(auth.uid, requestId);
    if (previousResult) return previousResult;

    const defaultStatus = requireString(data?.defaultStatus, 'Status akses default');
    if (!['unlimited', 'free_tier', 'inactive'].includes(defaultStatus)) {
      const error = new Error('Status akses default tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }

    const policyRef = db.doc('config/accessPolicy');
    return commitAdminMutation((transaction) => transaction.set(policyRef, {
      defaultStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    }, { merge: true }), auth.uid,
      'update_access_policy',
      `Status akses default diubah menjadi ${defaultStatus}`,
      { defaultStatus },
      requestId,
      { ok: true },
    );
  });
});

exports.updateTrialPolicy = functions.https.onRequest((request, response) => {
  runAdmin(request, response, async (auth, data) => {
    const requestId = requireDocumentId(data?.requestId, 'ID permintaan');
    const previousResult = await getCommittedAdminMutation(auth.uid, requestId);
    if (previousResult) return previousResult;

    const enabled = data?.enabled;
    const durationDays = Number(data?.durationDays);
    if (typeof enabled !== 'boolean') {
      const error = new Error('Status trial tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      const error = new Error('Durasi trial harus berupa 1–365 hari.');
      error.code = 'invalid-argument';
      throw error;
    }

    const policyRef = db.doc('config/trialPolicy');
    return commitAdminMutation((transaction) => transaction.set(policyRef, {
      enabled,
      durationDays,
      startsAtFirstAiAccess: true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    }, { merge: true }), auth.uid,
      'update_trial_policy',
      `Kebijakan trial ${enabled ? 'diaktifkan' : 'dinonaktifkan'} (${durationDays} hari)`,
      { enabled, durationDays, startsAtFirstAiAccess: true },
      requestId,
      { ok: true },
    );
  });
});

exports.startTrialOnFirstAiAccess = functions.https.onRequest((request, response) => {
  runAuthenticated(request, response, async (auth) => {
    const uid = auth.uid;
    const policyRef = db.doc('config/trialPolicy');
    const accessRef = db.doc(`access/${uid}`);

    return db.runTransaction(async (transaction) => {
      const [policySnapshot, accessSnapshot] = await Promise.all([
        transaction.get(policyRef),
        transaction.get(accessRef),
      ]);
      const policy = policySnapshot.data();
      const existing = accessSnapshot.data() || {};

      if (!policy?.enabled || !Number.isInteger(policy.durationDays)) {
        return { started: false, reason: 'trial-disabled' };
      }
      const blockReason = getTrialStartBlockReason(existing);
      if (blockReason) return { started: false, reason: blockReason };

      const startedAt = Timestamp.now();
      const endsAt = Timestamp.fromMillis(
        startedAt.toMillis() + policy.durationDays * 24 * 60 * 60 * 1000,
      );
      transaction.set(accessRef, {
        effectiveStatus: 'free_tier',
        source: 'trial',
        trialStartedAt: startedAt,
        trialEndsAt: endsAt,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return { started: true, trialEndsAt: endsAt.toDate().toISOString() };
    });
  });
});

exports.createAccessCampaign = functions.https.onRequest((request, response) => {
  runAdminMutation(request, response, async (auth, requestId, previousResult, data) => {
    if (previousResult) return previousResult;
    const campaign = getCampaignInput(data);
    await assertNoCampaignConflict(campaign);

    const campaignRef = db.collection('accessCampaigns').doc();
    return commitAdminMutation((transaction) => transaction.create(campaignRef, {
      ...campaign,
      timezone: 'Asia/Jakarta',
      enabled: true,
      status: campaignStatus({ ...campaign, enabled: true }),
      accessReconciledAt: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: auth.uid,
    }), auth.uid,
      'create_access_campaign',
      `Kampanye akses "${campaign.name}" dibuat`,
      {
        campaignId: campaignRef.id,
        target: campaign.target,
        uids: campaign.uids,
        startAt: campaign.startAt.toDate().toISOString(),
        endAtExclusive: campaign.endAtExclusive.toDate().toISOString(),
        postExpiryStatus: campaign.postExpiryStatus,
      },
      requestId,
      { ok: true, campaignId: campaignRef.id },
    );
  });
});

exports.updateAccessCampaign = functions.https.onRequest((request, response) => {
  runAdminMutation(request, response, async (auth, requestId, previousResult, data) => {
    const campaignId = requireDocumentId(data?.campaignId, 'ID kampanye');
    const campaignRef = db.doc(`accessCampaigns/${campaignId}`);
    const currentSnapshot = await campaignRef.get();
    if (!currentSnapshot.exists) {
      const error = new Error('Kampanye tidak ditemukan.');
      error.code = 'not-found';
      throw error;
    }
    if (previousResult) {
      if (currentSnapshot.data().accessReconciledAt === null) {
        await expireCampaignAccess(campaignId, currentSnapshot.data());
      }
      return previousResult;
    }

    if (['ended', 'cancelled'].includes(currentSnapshot.data().status)) {
      const error = new Error('Kampanye yang telah diakhiri tidak dapat diedit.');
      error.code = 'failed-precondition';
      throw error;
    }

    const campaign = getCampaignInput(data);
    await assertNoCampaignConflict(campaign, campaignId);
    const enabled = currentSnapshot.data().enabled !== false;
    const status = campaignStatus({ ...campaign, enabled });

    const result = await commitAdminMutation((transaction) => transaction.update(campaignRef, {
      ...campaign,
      timezone: 'Asia/Jakarta',
      status,
      accessReconciledAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    }), auth.uid,
      'update_access_campaign',
      `Kampanye akses "${campaign.name}" diperbarui`,
      { campaignId, status, target: campaign.target, uids: campaign.uids },
      requestId,
      { ok: true, status },
    );
    await expireCampaignAccess(campaignId, campaign);
    return result;
  });
});

exports.setAccessCampaignEnabled = functions.https.onRequest((request, response) => {
  runAdminMutation(request, response, async (auth, requestId, previousResult, data) => {
    const campaignId = requireDocumentId(data?.campaignId, 'ID kampanye');
    const enabled = data?.enabled;
    if (typeof enabled !== 'boolean') {
      const error = new Error('Status kampanye tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }

    const campaignRef = db.doc(`accessCampaigns/${campaignId}`);
    const campaignSnapshot = await campaignRef.get();
    if (!campaignSnapshot.exists) {
      const error = new Error('Kampanye tidak ditemukan.');
      error.code = 'not-found';
      throw error;
    }

    const campaign = campaignSnapshot.data();
    if (previousResult) {
      if (data?.enabled === false && campaign.accessReconciledAt === null) {
        await expireCampaignAccess(campaignId, campaign);
        await markCampaignAccessReconciled(campaignRef, ['paused']);
      }
      return previousResult;
    }
    if (enabled) {
      if (['ended', 'cancelled'].includes(campaign.status)) {
        const error = new Error('Kampanye yang telah diakhiri tidak dapat diaktifkan kembali.');
        error.code = 'failed-precondition';
        throw error;
      }
      if (campaign.endAtExclusive?.toMillis?.() <= Date.now()) {
        const error = new Error('Kampanye yang telah kedaluwarsa tidak dapat diaktifkan kembali.');
        error.code = 'failed-precondition';
        throw error;
      }
      await assertNoCampaignConflict(campaign, campaignId);
    }
    const status = enabled ? campaignStatus({ ...campaign, enabled: true }) : 'paused';
    const result = await commitAdminMutation((transaction) => transaction.update(campaignRef, {
      enabled,
      status,
      accessReconciledAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    }), auth.uid,
      enabled ? 'enable_access_campaign' : 'disable_access_campaign',
      `Kampanye akses "${campaign.name}" ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`,
      { campaignId, status, target: campaign.target, uids: campaign.uids || [] },
      requestId,
      { ok: true, status },
    );
    if (!enabled) {
      await expireCampaignAccess(campaignId, campaign);
      await markCampaignAccessReconciled(campaignRef, ['paused']);
    }
    return result;
  });
});

exports.endAccessCampaign = functions.https.onRequest((request, response) => {
  runAdminMutation(request, response, async (auth, requestId, previousResult, data) => {
    const campaignId = requireDocumentId(data?.campaignId, 'ID kampanye');
    const campaignRef = db.doc(`accessCampaigns/${campaignId}`);
    const campaignSnapshot = await campaignRef.get();
    if (!campaignSnapshot.exists) {
      const error = new Error('Kampanye tidak ditemukan.');
      error.code = 'not-found';
      throw error;
    }

    const campaign = campaignSnapshot.data();
    if (previousResult) {
      if (campaign.accessReconciledAt === null) {
        await expireCampaignAccess(campaignId, campaign);
        await markCampaignAccessReconciled(campaignRef, ['ended']);
      }
      return previousResult;
    }

    if (['ended', 'cancelled'].includes(campaign.status)) {
      await expireCampaignAccess(campaignId, campaign);
      await markCampaignAccessReconciled(campaignRef, [campaign.status]);
      return { ok: true, status: campaign.status };
    }

    const result = await commitAdminMutation((transaction) => transaction.update(campaignRef, {
      enabled: false,
      status: 'ended',
      accessReconciledAt: null,
      endedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    }), auth.uid,
      'end_access_campaign',
      `Kampanye akses "${campaign.name}" diakhiri`,
      { campaignId, target: campaign.target, uids: campaign.uids || [] },
      requestId,
      { ok: true, status: 'ended' },
    );
    await expireCampaignAccess(campaignId, campaign);
    await markCampaignAccessReconciled(campaignRef, ['ended']);
    return result;
  });
});

exports.updateFeedbackReview = functions.https.onRequest((request, response) => {
  runAdmin(request, response, async (auth, data) => {
    const requestId = requireDocumentId(data?.requestId, 'ID permintaan');
    const previousResult = await getCommittedAdminMutation(auth.uid, requestId);
    if (previousResult) return previousResult;

    const feedbackId = requireDocumentId(data?.feedbackId, 'ID feedback');
    const status = requireString(data?.status, 'Status peninjauan');
    if (!['new', 'reviewing', 'reviewed'].includes(status)) {
      const error = new Error('Status peninjauan tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }

    const feedbackRef = db.doc(`feedback/${feedbackId}`);
    const feedbackSnapshot = await feedbackRef.get();
    if (!feedbackSnapshot.exists) {
      const error = new Error('Feedback tidak ditemukan.');
      error.code = 'not-found';
      throw error;
    }

    return commitAdminMutation((transaction) => transaction.update(feedbackRef, {
      status,
      reviewedAt: status === 'reviewed' ? FieldValue.serverTimestamp() : null,
      reviewedBy: auth.uid,
    }), auth.uid,
      'review_feedback',
      `Status feedback ${feedbackId} diubah menjadi ${status}`,
      { feedbackId, status },
      requestId,
      { ok: true },
    );
  });
});

exports.updateNoticeConfig = functions.https.onRequest((request, response) => {
  runAdmin(request, response, async (auth, data) => {
    const requestId = requireDocumentId(data?.requestId, 'ID permintaan');
    const previousResult = await getCommittedAdminMutation(auth.uid, requestId);
    if (previousResult) return previousResult;

    const enabled = data?.enabled;
    const expiryReminderEnabled = data?.expiryReminderEnabled;
    const target = requireString(data?.target, 'Target pemberitahuan');
    const suppliedUids = data?.uids;
    const messagesInput = data?.messages;
    if (typeof enabled !== 'boolean') {
      const error = new Error('Status pemberitahuan tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (typeof expiryReminderEnabled !== 'boolean') {
      const error = new Error('Status pengingat masa akses tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (!['all_users', 'selected_users'].includes(target)) {
      const error = new Error('Target pemberitahuan tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (target === 'selected_users' && !Array.isArray(suppliedUids)) {
      const error = new Error('Daftar UID penerima tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }

    const uids = target === 'selected_users'
      ? [...new Set(suppliedUids.map((uid) => {
        if (typeof uid !== 'string' || uid.trim().length === 0 || uid.trim().length > 128) {
          const error = new Error('Setiap UID penerima harus berupa teks yang valid.');
          error.code = 'invalid-argument';
          throw error;
        }
        return uid.trim();
      }))] : [];
    if (target === 'selected_users' && (uids.length === 0 || uids.length > 500)) {
      const error = new Error('Pilih 1–500 UID untuk target pemberitahuan.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (!messagesInput || typeof messagesInput !== 'object' || Array.isArray(messagesInput)) {
      const error = new Error('Pesan pemberitahuan tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }

    const messages = {};
    for (const [key, label] of [
      ['accessChanged', 'Pemberitahuan perubahan akses'],
      ['expiryReminder', 'Pengingat masa akses'],
      ['accessEnded', 'Pemberitahuan akses berakhir'],
    ]) {
      const message = requireString(messagesInput[key], label);
      if (message.length > 500) {
        const error = new Error(`${label} maksimal 500 karakter.`);
        error.code = 'invalid-argument';
        throw error;
      }
      messages[key] = message;
    }

    const noticeRef = db.doc('config/inAppNotifications');
    const targetRef = db.doc('config/inAppNotificationTargets');
    return commitAdminMutation((transaction) => {
      transaction.set(noticeRef, {
        enabled,
        expiryReminderEnabled,
        target,
        messages,
        message: messages.accessChanged,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      });
      transaction.set(targetRef, {
        uids,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      });
    }, auth.uid,
      'update_in_app_notifications',
      `Pemberitahuan akses ${enabled ? 'aktif' : 'nonaktif'}; pengingat masa akhir ${expiryReminderEnabled ? 'aktif' : 'nonaktif'}`,
      {
        enabled,
        expiryReminderEnabled,
        target,
        recipientCount: target === 'all_users' ? null : uids.length,
        messageLengths: Object.fromEntries(
          Object.entries(messages).map(([key, value]) => [key, value.length]),
        ),
      },
      requestId,
      { ok: true },
    );
  });
});

exports.getInAppNotificationConfig = functions.https.onRequest((request, response) => {
  runAuthenticated(request, response, async (auth) => {
    const [noticeSnapshot, targetsSnapshot] = await Promise.all([
      db.doc('config/inAppNotifications').get(),
      db.doc('config/inAppNotificationTargets').get(),
    ]);
    const notice = noticeSnapshot.data();
    const targets = targetsSnapshot.data();
    const shouldReceive = notice?.target === 'all_users'
      || (notice?.target === 'selected_users' && targets?.uids?.includes(auth.uid));

    if (!notice || !shouldReceive) {
      return { enabled: false, expiryReminderEnabled: false, messages: {} };
    }
    return {
      enabled: notice.enabled === true,
      expiryReminderEnabled: notice.expiryReminderEnabled === true,
      messages: notice.messages || {},
    };
  });
});

exports.updateFeedbackPromptConfig = functions.https.onRequest((request, response) => {
  runAdmin(request, response, async (auth, data) => {
    const requestId = requireDocumentId(data?.requestId, 'ID permintaan');
    const previousResult = await getCommittedAdminMutation(auth.uid, requestId);
    if (previousResult) return previousResult;

    const enabled = data?.enabled;
    const initialDelayDays = Number(data?.initialDelayDays);
    const cooldownHours = Number(data?.cooldownHours);

    if (typeof enabled !== 'boolean') {
      const error = new Error('Status prompt tidak valid.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (!Number.isInteger(initialDelayDays) || initialDelayDays < 0 || initialDelayDays > 30) {
      const error = new Error('Penundaan awal harus berupa 0–30 hari.');
      error.code = 'invalid-argument';
      throw error;
    }
    if (!Number.isInteger(cooldownHours) || cooldownHours < 1 || cooldownHours > 720) {
      const error = new Error('Interval cooldown harus berupa 1–720 jam.');
      error.code = 'invalid-argument';
      throw error;
    }

    const promptRef = db.doc('config/feedbackPrompts');
    return commitAdminMutation((transaction) => transaction.set(promptRef, {
      enabled,
      initialDelayDays,
      cooldownHours,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    }, { merge: true }), auth.uid,
      'update_feedback_prompts',
      `Prompt feedback diubah menjadi ${enabled ? 'aktif' : 'nonaktif'} (${initialDelayDays} hari, ${cooldownHours} jam)`,
      { enabled, initialDelayDays, cooldownHours },
      requestId,
      { ok: true },
    );
  });
});
