const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : process.argv[index + 1] || '';
}

const projectId = readOption('--project-id');
const confirmedProjectId = readOption('--confirm-project-id');
const activeProjectId = process.env.GCLOUD_PROJECT
  || process.env.GCP_PROJECT
  || process.env.GOOGLE_CLOUD_PROJECT;

if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  throw new Error('Gunakan --project-id dengan ID Firebase project yang valid.');
}
if (confirmedProjectId !== projectId) {
  throw new Error('Konfirmasi target dengan --confirm-project-id yang sama dengan --project-id.');
}
if (activeProjectId && activeProjectId !== projectId) {
  throw new Error(`Project aktif tidak cocok dengan target yang dikonfirmasi: ${activeProjectId}`);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Seeder ini ditujukan untuk Firestore Cloud, tetapi FIRESTORE_EMULATOR_HOST masih terpasang.');
}

initializeApp({ projectId });
const db = getFirestore();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => Timestamp.fromMillis(Date.now() - days * DAY);
const daysFromNow = (days) => Timestamp.fromMillis(Date.now() + days * DAY);

async function seed() {
  const users = [
    ['demo_seed_v2_uid_001', 'andi@example.com', 21, 0.25],
    ['demo_seed_v2_uid_002', 'siti@example.com', 17, 1],
    ['demo_seed_v2_uid_003', 'rina@example.com', 12, 4],
    ['demo_seed_v2_uid_004', 'dimas@example.com', 10, 0.5],
    ['demo_seed_v2_uid_005', 'maya@example.com', 3, 2],
  ].map(([uid, email, createdDaysAgo, lastSeenDaysAgo]) => [
    `users/${uid}`,
    {
      email,
      createdAt: daysAgo(createdDaysAgo),
      lastSeenAt: daysAgo(lastSeenDaysAgo),
      status: 'active',
      isDemo: true,
    },
  ]);

  const access = [
    ['demo_seed_v2_uid_001', { effectiveStatus: 'unlimited', source: 'default_policy' }],
    ['demo_seed_v2_uid_002', {
      effectiveStatus: 'date_limited_free',
      source: 'campaign',
      campaignId: 'demo_seed_v2_campaign_akhir_tahun',
    }],
    ['demo_seed_v2_uid_003', {
      effectiveStatus: 'free_tier',
      source: 'trial',
      trialEndsAt: daysFromNow(10),
    }],
    ['demo_seed_v2_uid_004', { effectiveStatus: 'active', source: 'payment_active' }],
    ['demo_seed_v2_uid_005', { effectiveStatus: 'inactive', source: 'campaign_expired' }],
  ].map(([uid, data]) => [
    `access/${uid}`,
    { ...data, updatedAt: daysAgo(0.5), isDemo: true },
  ]);

  const feedback = [
    ['demo_seed_v2_feedback_1', {
      uid: 'demo_seed_v2_uid_001',
      category: 'Kemudahan penggunaan',
      message: 'Form pencatatan pengeluaran sangat mudah digunakan.',
      status: 'new',
      createdAt: daysAgo(0.25),
    }],
    ['demo_seed_v2_feedback_2', {
      uid: 'demo_seed_v2_uid_003',
      category: 'Fitur',
      message: 'Tambahkan ringkasan pengeluaran mingguan.',
      status: 'reviewing',
      createdAt: daysAgo(1),
    }],
    ['demo_seed_v2_feedback_3', {
      uid: 'demo_seed_v2_uid_005',
      category: 'Bug',
      message: 'Nilai kategori kadang tidak langsung diperbarui.',
      status: 'reviewed',
      createdAt: daysAgo(3),
    }],
  ].map(([id, data]) => [`feedback/${id}`, { ...data, isDemo: true }]);

  const campaigns = [
    ['demo_seed_v2_campaign_akhir_tahun', {
      name: 'Akses Gratis Akhir Tahun',
      target: 'all_users',
      uids: [],
      startAt: daysAgo(2),
      endAtExclusive: daysFromNow(8),
      postExpiryStatus: 'inactive',
      status: 'active',
      createdAt: daysAgo(2),
    }],
    ['demo_seed_v2_campaign_uji', {
      name: 'Coba Fitur AI - Kelompok Uji',
      target: 'selected_users',
      uids: ['demo_seed_v2_uid_002', 'demo_seed_v2_uid_003'],
      startAt: daysAgo(12),
      endAtExclusive: daysAgo(1),
      postExpiryStatus: 'free_tier',
      status: 'expired',
      createdAt: daysAgo(12),
    }],
  ].map(([id, data]) => [
    `accessCampaigns/${id}`,
    { ...data, createdBy: 'demo-seed', isDemo: true },
  ]);

  const activity = [
    ['demo_seed_v2_activity_campaign', {
      type: 'create_access_campaign',
      summary: 'Kampanye akses gratis "Akses Gratis Akhir Tahun" dibuat',
      metadata: {
        campaignId: 'demo_seed_v2_campaign_akhir_tahun',
        target: 'all_users',
        uids: [],
      },
      createdAt: daysAgo(0.5),
    }],
    ['demo_seed_v2_activity_feedback', {
      type: 'review_feedback',
      summary: 'Status feedback demo_seed_v2_feedback_2 diubah menjadi Sedang ditinjau',
      metadata: { feedbackId: 'demo_seed_v2_feedback_2', status: 'reviewing' },
      createdAt: daysAgo(1),
    }],
    ['demo_seed_v2_activity_prompts', {
      type: 'update_feedback_prompts',
      summary: 'Prompt feedback diaktifkan (2 hari, 48 jam)',
      metadata: { enabled: true, initialDelayDays: 2, cooldownHours: 48 },
      createdAt: daysAgo(2),
    }],
  ].map(([id, data]) => [
    `adminActivity/${id}`,
    { ...data, adminUid: 'demo-seed', isDemo: true },
  ]);

  const demoDocuments = [...users, ...access, ...feedback, ...campaigns, ...activity];
  const configDefaults = [
    ['config/accessPolicy', { defaultStatus: 'unlimited' }],
    ['config/trialPolicy', { enabled: false, durationDays: 7, startsAtFirstAiAccess: true }],
    ['config/inAppNotifications', {
      enabled: true,
      expiryReminderEnabled: true,
      target: 'all_users',
      uids: [],
      messages: {
        accessChanged: 'Status akses AI Anda berubah menjadi {status}.',
        expiryReminder: 'Akses AI Anda akan berakhir pada {endDate} ({timezone}).',
        accessEnded: 'Akses AI Anda berakhir pada {endDate} ({timezone}).',
      },
      message: 'Status akses AI Anda berubah menjadi {status}.',
    }],
    ['config/feedbackPrompts', { enabled: true, initialDelayDays: 2, cooldownHours: 48 }],
  ];

  await db.runTransaction(async (transaction) => {
    const demoRefs = demoDocuments.map(([path]) => db.doc(path));
    const configRefs = configDefaults.map(([path]) => db.doc(path));
    const [demoSnapshots, configSnapshots] = await Promise.all([
      Promise.all(demoRefs.map((ref) => transaction.get(ref))),
      Promise.all(configRefs.map((ref) => transaction.get(ref))),
    ]);

    const conflictingDocument = demoSnapshots.find(
      (snapshot) => snapshot.exists && snapshot.data()?.isDemo !== true,
    );
    if (conflictingDocument) {
      throw new Error(`Seeder dihentikan karena dokumen ${conflictingDocument.ref.path} bukan data demo.`);
    }

    demoDocuments.forEach(([, data], index) => {
      transaction.set(demoRefs[index], data);
    });
    configSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        transaction.create(configRefs[index], {
          ...configDefaults[index][1],
          updatedBy: 'demo-seed',
          updatedAt: Timestamp.now(),
          isDemo: true,
        });
      }
    });
  });

  console.log(`Dummy data tersimpan di Firestore Cloud project ${projectId}.`);
  console.log('Dokumen yang bukan data demo tidak ditimpa; config yang sudah ada dipertahankan.');
  console.log('Tidak ada akun Firebase Authentication yang dibuat.');
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
