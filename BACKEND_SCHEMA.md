# Arus Dana Dashboard - Backend Schema

## Collections

- `users/{uid}`: metadata akun minimum, `createdAt`, `lastSeenAt`, `status`.
- `access/{uid}`: `effectiveStatus`, `source`, `trialEndsAt`, `campaignId`, `updatedAt`.
- `feedback/{feedbackId}`: `uid`, `category`, `message`, `status`, `createdAt`, `reviewedAt`, `reviewedBy`.
- `accessCampaigns/{campaignId}`: `name`, `target`, `uids`, `startAt`, `endAtExclusive`, `timezone`, `postExpiryStatus`, `enabled`, `status`, and create/update/end metadata.
- `config/accessPolicy`: kebijakan default dan pembaruan admin.
- `config/trialPolicy`: `enabled`, `durationDays`, `startsAtFirstAiAccess`, dan metadata pembaruan admin.
- `config/inAppNotifications`: aktif/nonaktif, target (`all_users` atau `selected_users`), pengingat sebelum akses berakhir, serta template pesan perubahan/akhir akses. Placeholder yang disediakan: `{status}`, `{endDate}`, dan `{timezone}`. Dokumen hanya boleh dibaca admin; Mobile App menggunakan callable personalisasi.
- `config/inAppNotificationTargets`: daftar UID target yang hanya boleh dibaca admin.
- `config/feedbackPrompts`: `enabled`, `initialDelayDays`, `cooldownHours`, `updatedAt`, `updatedBy`.
- `adminActivity/{activityId}`: `adminUid`, `type`, `summary`, `metadata`, `createdAt`.

Trial pertama kali dimulai hanya melalui callable `startTrialOnFirstAiAccess` saat kebijakan aktif. Waktu mulai dan akhir ditentukan server; satu UID tidak dapat memulai ulang trial yang sudah pernah dimulai.

## Kontrak status akses (target integrasi)

> Kontrak ini menjadi target implementasi; enforcement expiry belum boleh dianggap siap produksi sampai Cloud Functions dan test emulator membuktikannya.

- Dokumen `access/{uid}` adalah status efektif yang dibaca klien untuk UID miliknya. Klien tidak menulis status akses, tidak menghitung hak akses dari campaign, dan tidak menganggap `campaign.status` sebagai otoritas entitlement.
- `effectiveStatus` yang digunakan aplikasi: `unlimited`, `active`, `date_limited_free`, `free_tier`, atau `inactive`. `source` menjelaskan asal status, misalnya `default_policy`, `campaign`, `trial`, `campaign_expired`, atau `manual_override`.
- Akses `unlimited`, `active`/entitlement berbayar bila kelak ada, dan `manual_override` tidak boleh diturunkan oleh pemanggilan trial atau rekonsiliasi trial.
- `startTrialOnFirstAiAccess` harus idempoten. Trial hanya dimulai untuk status/sumber dasar yang diizinkan, tidak pernah dimulai ulang setelah `trialStartedAt` tercatat, dan server menentukan `trialEndsAt`.
- Saat campaign berakhir atau dihentikan, server menerapkan `postExpiryStatus` hanya ke akses yang masih berasal dari campaign tersebut. Perubahan harus idempoten dan tidak boleh menimpa override/entitlement yang lebih tinggi.
- Saat trial berakhir, server mengembalikan akses trial ke `config/accessPolicy.defaultStatus` (atau baseline eksplisit yang ditetapkan kebijakan). Penghapusan metadata trial dan perubahan status dilakukan bersama agar retry aman.
- Tanggal campaign adalah hari kalender Asia/Jakarta dengan `endAtExclusive` sebagai batas akhir eksklusif. Klien menampilkan status berdasarkan data server dan waktu terkini; keputusan entitlement tetap server-side.

### Integrasi Mobile App

1. Gunakan Firebase project/environment yang sama dengan backend yang telah diverifikasi; konfigurasi web Firebase bersifat publik, jangan menanam service-account atau secret.
2. Setelah autentikasi, baca hanya `access/{uid}` untuk UID pengguna. Tangani status loading/error; jangan menjadikan cache lama sebagai izin final untuk operasi terlindungi.
3. Ambil pemberitahuan yang sesuai pengguna melalui callable `getInAppNotificationConfig`; jangan membaca dokumen target atau mengunduh daftar UID.
4. Sebelum fitur AI yang memerlukan trial, panggil `startTrialOnFirstAiAccess` dengan sesi Firebase pengguna. Gunakan hasil callable dan status `access/{uid}` terbaru; jangan menulis `access` dari klien.
5. Perlakukan `permission-denied`, `unauthenticated`, `failed-precondition`, dan kegagalan jaringan sebagai hasil berbeda; retry tidak boleh membuat trial/campaign ganda.
6. Uji kasus default, trial aktif/berakhir, campaign aktif/berakhir/dihentikan, unlimited, manual override, reconnect, dan dua request bersamaan terhadap Firebase Emulator/staging.

## Security

- Browser dapat membaca data sesuai aturan; seluruh write administratif dilakukan oleh callable Cloud Functions.
- Satu UID Firebase Auth yang dikonfigurasi menjadi allowlist admin: `VITE_FIREBASE_ADMIN_UID` pada web, `ADMIN_UID` pada Functions, dan UID literal pada Firestore Rules. Semua nilai wajib sama; frontend allowlist hanya untuk UX, sementara Functions dan Rules menegakkan akses. Custom claim admin tidak digunakan.
- Tidak ada ledger, saldo, amplop, nominal transaksi, kategori pengeluaran, atau deskripsi transaksi dalam schema ini.
- Service-account key dan Midtrans secret tidak boleh ditempatkan di web bundle atau environment `VITE_*`.

## Setup

1. Pasang Firebase CLI dan login ke Firebase project dashboard yang sudah diperiksa.
2. Berikan claim admin ke akun Founder pada project yang benar dengan perintah bootstrap yang memerlukan project ID dan konfirmasi eksplisit.
3. Jalankan emulator atau deploy rules/functions setelah schema diterapkan.
