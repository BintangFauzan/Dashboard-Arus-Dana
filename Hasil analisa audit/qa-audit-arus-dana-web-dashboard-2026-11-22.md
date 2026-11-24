# Laporan QA Audit — arus-dana-web-dashboard

- **Auditor:** Rigel (QA & Release Engineer)
- **Tanggal audit:** 22 November 2026, 23:10 WIB (Asia/Jakarta)
- **Target:** `D:\Belajar\React Native\Arus Dana Versi baru\Web Dashboard\Arus Dana Web Dashboard\arus-dana-web-dashboard`
- **Mode:** Read-only. Tidak ada file project yang diubah, dibuat, atau dihapus.
- **Metode:** Inspeksi kode sumber, konfigurasi, rules, dependencies, artifact `dist` (21:17), lint, `npm audit`, dan preview di `localhost:4173`.

---

## 1. Keputusan Rilis

| Konteks | Keputusan |
|---|---|
| Produksi | **NO-GO** |
| Demo internal | **CONDITIONAL GO** — hanya jika gating akses AI & pembayaran dimatikan |

**Alasan NO-GO produksi:** F-01 dan F-02 adalah release-blocking. Enforcement akses kampanye/kedaluwarsa tidak ada di backend, dan trial dapat menurunkan akses `unlimited`. Sampai kontrak enforcement dibuktikan (termasuk di Mobile App), klaim "akses dikelola server-side" belum terpenuhi.

---

## 2. Ringkas Bukti yang Dijalankan

- `npm run lint` → **lulus**, 0 error.
- `eslint` pada `functions/index.js` dan `functions/seed-demo.js` → **lulus**.
- `npm audit --omit=dev` → **4 high** (rantai `firebase` → `@grpc/grpc-js`).
- Preview artifact `dist` di `localhost:4173` → gate login tampil, **tidak ada data terproteksi bocor** sebelum auth; 1 console error: favicon 404.
- UID admin di `.env.local`, `firestore.rules`, dan `functions/index.js` → **konsisten** (dibandingkan tanpa mencetak nilai).
- Bundle `dist` → **tidak ada** endpoint emulator, service-account key, private key, atau secret Midtrans.

---

## 3. Temuan

### F-01 · HIGH · Enforcement akses kampanye & trial tidak ada di backend

- **Komponen:** `functions/index.js`
- **Bukti:** `functions/index.js:234-374` hanya menyimpan data kampanye. Tidak ada scheduled function, trigger, ataupun penulisan `access/{uid}` saat kampanye dibuat/berakhir. `postExpiryStatus` disimpan di `:259` tetapi **tidak pernah dipakai**. Satu-satunya penulis `access/{uid}` adalah `startTrialOnFirstAiAccess` (`:194`, `:222-228`).
- **Dampak:** Janji "setelah berakhir: inactive / free_tier / unlimited" dan pencabutan akses kampanye hanya ada di UI. `access.effectiveStatus` tidak pernah berubah karena waktu. Fitur inti dashboard tidak berfungsi.
- **Rekomendasi (untuk developer):** Tambahkan scheduled reconcile atau trigger yang menulis `access/{uid}`. Dokumentasikan secara eksplisit siapa pemilik kebenaran status akses (server vs klien).
- **Kriteria verifikasi:** Buat kampanye 1 hari → periksa dokumen `access` sebelum dan sesudah melewati tengah malam Asia/Jakarta → cek perilaku AI di mobile.

### F-02 · HIGH · Trial dapat menurunkan akses `unlimited`

- **Komponen:** `functions/index.js:210-216`
- **Bukti:** Guard hanya menolak `active`, `date_limited_free`, `manual_override`. Status `unlimited` lolos, lalu `:222-228` menimpa menjadi `free_tier` + `trialEndsAt`.
- **Dampak:** Siapa pun yang login dapat memanggil callable ini (mobile memanggilnya saat akses AI pertama). Akses `unlimited` bisa hilang tanpa peringatan.
- **Rekomendasi:** Tolak jika `effectiveStatus` termasuk `unlimited`, atau jika `source` bukan `default`/`campaign_expired`. Gunakan **allowlist**, bukan blocklist.
- **Kriteria verifikasi:** Set `unlimited` → panggil callable → respons `started:false`, dokumen tidak berubah.

### F-03 · MEDIUM · Field `campaign.status` cepat basi

- **Bukti:** `status` hanya ditulis saat create/update/enable/end (`:244`, `:283`, `:327`, `:360-361`). Tidak ada job yang mengubahnya menjadi `expired`. Dashboard menghitung ulang di klien (`campaignUtils.js:1-11`), tetapi konsumen lain (mobile/BI) yang membaca field akan melihat `active` selamanya.
- **Rekomendasi:** Buang `status` sebagai otoritas, atau rekonsiliasi berkala.
- **Verifikasi:** Kampanye melewati end date → field tetap `active` (reproduksi).

### F-04 · MEDIUM · Race condition / TOCTOU pada kampanye

- **Bukti:** `assertNoCampaignConflict` membaca seluruh koleksi lalu menulis, tanpa transaksi (`:94-113`, dipakai `:238`, `:281`, `:325`).
- **Dampak:** Dua request paralel (dua tab / dua admin) bisa sama-sama lolos → kampanye tumpang tindih. `end` vs `enable` juga bisa saling menimpa (`:344-374` vs `:302-342`) sehingga kampanye yang sudah diakhiri hidup kembali.
- **Rekomendasi:** Transaksi + kunci dokumen (mis. `config/campaignLock`), atau cek ulang di dalam transaksi dan terima batasannya secara eksplisit.
- **Verifikasi:** 2 request create overlap bersamaan → hanya 1 tersimpan.

### F-05 · MEDIUM · Mutasi dan audit log tidak atomik

- **Bukti:** `writeAdminActivity` di-`await` setelah `set`/`update` (mis. `:249-261`).
- **Dampak:** Jika log gagal, klien menerima error padahal perubahan sudah tersimpan; retry membuat data ganda. Tidak ada idempotency key.
- **Rekomendasi:** Tulis keduanya dalam `batch`/transaksi, atau jadikan log best-effort + tandai.
- **Verifikasi:** Simulasikan gagal tulis log → respons sukses, data konsisten.

### F-06 · MEDIUM · Skala: seluruh koleksi dibaca live dan dirender

- **Bukti:** `DataProvider.jsx:44-79` memasang 9 listener tanpa `limit`; `users`, `access`, `feedback`, `adminActivity` tumbuh tanpa batas. Tidak ada pagination/virtualisasi; filter di memori (`DashboardPages.jsx:95-103`, `526-539`). Feedback berisi PII dan tanpa retensi.
- **Dampak:** Biaya baca naik terus, waktu muat dan memori memburuk, satu snapshot error memblokir sumber lain.
- **Rekomendasi:** `limit` + cursor, filter server-side, arsip/TTL untuk `feedback` dan `adminActivity`.
- **Verifikasi:** 10k dokumen uji → waktu muat dan jumlah read terukur.
- **Catatan:** Query `orderBy('createdAt')` menyembunyikan dokumen tanpa field itu (users/feedback/activity) — hitungan dashboard bisa lebih kecil dari isi koleksi.

### F-07 · MEDIUM · Daftar UID target bocor ke semua pengguna login

- **Bukti:** `firestore.rules:47-50` memberi `config/**` ke `isSignedIn()`. `config/inAppNotifications.uids` (sampai 500 UID, `functions/index.js:436`) ikut terbaca oleh pengguna aplikasi biasa.
- **Rekomendasi:** Pindahkan daftar penerima ke koleksi khusus admin, atau pisahkan dokumen config yang boleh dibaca mobile.
- **Verifikasi:** User non-admin membaca `config/inAppNotifications` → `permission-denied`.

### F-08 · MEDIUM · Salah konfigurasi `VITE_FIREBASE_ADMIN_UID` gagal tanpa pesan jelas

- **Bukti:** `firebase.js:15-21` hanya memvalidasi 4 field config, bukan `adminUid`. Jika UID kosong/salah, login Firebase berhasil lalu langsung ditolak dan di-sign-out (`AuthProvider.jsx:27-37`) dengan pesan "Akun ini tidak terdaftar…", bukan layar setup. Admin bisa mengira akunnya rusak.
- **Rekomendasi:** Masukkan `adminUid` ke daftar konfigurasi wajib.
- **Verifikasi:** Kosongkan env → layar "Konfigurasi Firebase diperlukan".

### F-09 · MEDIUM · Status kampanye dan metrik 7 hari bisa basi tanpa batas

- **Bukti:** `referenceTime` hanya di-set saat snapshot settle (`DataProvider.jsx:32-41`), tidak ada ticker. Tab yang dibiarkan terbuka melewati waktu berakhir tetap menampilkan "Aktif" dan tombol Nonaktifkan/Akhiri masih bisa diklik (server menolak, tetapi UX menyesatkan). `DashboardPages.jsx:320` memakai `Date.now()` sendiri, jadi label dialog berbeda dari tabel.
- **Rekomendasi:** Timer 30–60 detik untuk `referenceTime`; pakai satu sumber waktu.
- **Verifikasi:** Biarkan tab terbuka melewati end date → label berubah sendiri.

### F-10 · MEDIUM · Aksesibilitas: teks 8–10px, kontras gagal, fokus hilang

- **Bukti:** Ukuran 8–10px dipakai 77+ tempat (`App.css`, `DashboardPages.css`). Rasio kontras terhitung:
  - `#9aa0a8` → 2.64:1
  - `#9aa1a8` → 2.61:1 (2.46:1 di bg `#f7f8fa`)
  - `#a4a9b0` → 2.36:1
  - placeholder `#adb3b9` → 2.12:1
  - `#858d95` → 3.36:1

  Semua < 4.5:1 (WCAG 1.4.3). `outline: 0` pada `.search-field input`, `.select-field select`, dan field form kampanye (`DashboardPages.css:99,123,313`) tanpa pengganti → fokus keyboard tak terlihat (WCAG 2.4.7).
- **Rekomendasi:** Minimum 12px untuk label, gelapkan palet abu ke ≥4.5:1, tambahkan `:focus-visible` yang jelas.
- **Verifikasi:** Audit axe + traversal keyboard-only.

### F-11 · MEDIUM · 4 advisory high di dependensi

- **Bukti:** `npm audit --omit=dev`: `@firebase/firestore`, `@firebase/firestore-compat`, `@grpc/grpc-js`, `firebase` (CWE-295, GHSA-m9gg-hp2v-232j). Semua transitif; fix yang ditawarkan npm = downgrade `firebase` ke 9.14.0 → jangan diterapkan buta.
- **Catatan:** Bundle produksi tidak memuat string `@grpc/grpc-js` (hanya opsi `grpcFlowControlWindow`), jadi paparan runtime browser rendah. Tetap perlu triage & rencana upgrade.

### F-12 · MEDIUM · Tidak ada test otomatis

- **Bukti:** Tidak ada file `*.test.*`/`*.spec.*`, tidak ada script `test`, tidak ada CI.
- **Dampak:** Logika paling berisiko (status kampanye, validasi tanggal, guard trial, aturan Firestore) tidak punya bukti regresi. Ini gap, bukan bug.

### F-13 · MEDIUM · Rilis tidak dapat direproduksi

- **Bukti:** Tidak ada repo git di folder ini; versi `0.0.0`; tidak ada `.firebaserc` (target project tidak dipatok); `firebase.json` tidak punya hook `predeploy` build, jadi `firebase deploy` bisa mengunggah `dist` lama ke project yang salah.
- **Rekomendasi:** VCS + tag rilis, `.firebaserc`, `predeploy: npm run build && npm run lint`.

### F-14 · LOW · Opsi `{merge:true}` pada `update()` tidak berlaku

- **Bukti:** `functions/index.js:391-395` memakai `update(data, {merge:true})`. Pada `@google-cloud/firestore@7.11.6` (terpasang, sesuai `functions/package-lock.json`), argumen kedua adalah *Precondition*; `{merge:true}` dianggap precondition kosong → default `exists:true` hilang dan merge diabaikan. Tidak crash, tetapi menyesatkan; keunikan dokumen sudah dicek manual di `:386-389`.
- **Rekomendasi:** Hapus argumen kedua, atau pakai `set(data, {merge:true})` bila memang ingin merge.

### F-15 · LOW · Validasi input kurang di tepi

- **Bukti:** `campaignId`/`feedbackId` dari klien masuk langsung ke path dokumen (`:269`, `:348`, `:379`); ID dengan `/` atau segmen ganjil membuat `doc()` melempar error → klien melihat `internal`, bukan `invalid-argument`. Tanggal masa lalu diterima (kampanye mati langsung), dan `endDate 9999-12-31` + 1 hari melampaui batas Timestamp.
- **Rekomendasi:** Regex ID, batasi rentang tanggal, bungkus jadi `HttpsError`.

### F-16 · LOW · Favicon 404

- **Bukti:** `index.html` tidak punya `<link rel="icon">` meski `public/favicon.svg` ada; browser meminta `/favicon.ico` → 404 (terbukti di konsol preview).
- **Rekomendasi:** Tambah satu baris.

### F-17 · LOW · Label aksesibel ganda & detail keyboard

- **Bukti:** Form Notices punya dua checkbox bernama "Aktif" (`DashboardPages.jsx:706,711`) tanpa pembeda → pembaca layar ambigu. Nav belum `aria-current="page"`. Spinner tanpa `prefers-reduced-motion`.

### F-18 · LOW · Otorisasi admin tersebar, tidak bisa dirotasi tanpa 3 deploy

- **Bukti:** UID hardcode di `firestore.rules:11`, `functions/index.js:7`, dan `.env.local`. Konsisten sekarang, tetapi rotasi/ganti admin rawan drift dan salah satu tempat bisa tertinggal.
- **Rekomendasi:** Custom claim `admin:true` + satu sumber.

### F-19 · LOW · Klaim UI lebih kuat dari implementasi

- **Bukti:** "Semua perubahan akses divalidasi server-side …" (`DashboardPages.jsx:501-503`) benar untuk *penulisan konfigurasi*, tetapi tidak ada penerapan akses ke pengguna (lihat F-01). Ada juga ketiadaan App Check/throttling pada callable.
- **Rekomendasi:** Perbaiki klaim atau implementasi.

### F-20 · INFO · Kebersihan housekeeping

- Index komposit `feedback(status,createdAt)` dan `accessCampaigns(status,startAt)` tidak dipakai query dashboard mana pun (`DataProvider.jsx`).
- Aset `src/assets/hero.png`, `react.svg`, `vite.svg`, `public/icons.svg` tidak direferensikan (≈30KB).
- `@types/react*` ada di proyek JS.
- Bundle satu chunk 817KB tanpa code-splitting.
- README belum menyebut `cd functions && npm install` dan `firebase emulators:start`.

---

## 4. Yang Lulus (Bukti, Bukan Asumsi)

- **Rules deny-by-default:** catch-all `allow read, write: if false` (`firestore.rules:57-59`). Tidak ada tulis klien ke `users`, `access`, `accessCampaigns`, `config`, `adminActivity`.
- **Feedback create dibatasi ketat:** uid harus = auth, status `new`, `createdAt == request.time`, pesan 1–2000 char, kategori ≤80, key whitelist (`:24-40`). Tidak ada update/delete klien.
- **Semua 9 callable admin** memanggil `requireAdmin`; hanya `startTrialOnFirstAiAccess` yang menerima user terautentikasi — sesuai desain (`functions/index.js:9-19`, `136-518`).
- **Validasi server memadai:** nama (≤120), UID (1–500, trim, dedup), tanggal kalender + zona Asia/Jakarta, `postExpiryStatus`, pesan (≤500), durasi trial (1–365), prompt (0–30 hari, 1–720 jam), enum status feedback.
- **Frontend bukan batas keamanan:** provider data hanya dipasang setelah gate lolos (`main.jsx:12-19`); rules/functions tetap memeriksa UID.
- **UID konsisten** di tiga lokasi (dibandingkan, nilai tidak dicetak).
- **Emulator aman:** `VITE_USE_FIREBASE_EMULATOR=false`; bundle `dist` bersih dari `127.0.0.1:8080/9099/5001`.
- **Tidak ada rahasia:** tidak ada service-account, private key, atau secret Midtrans di repo/bundle. Hanya config web publik Firebase + UID admin (bukan rahasia).
- **Tidak ada XSS sink:** nol `dangerouslySetInnerHTML`, `innerHTML`, `eval`; data dirender sebagai teks React.
- **Tidak ada token di storage:** nol `localStorage`/`sessionStorage`; sesi Firebase default.
- **Seeder aman:** wajib `--project-id` == `--confirm-project-id`, menolak `FIRESTORE_EMULATOR_HOST`, berhenti jika dokumen non-demo bentrok, tidak menimpa config, tidak membuat akun Auth (`seed-demo.js:15-26,176-196`).
- **Tanpa data keuangan:** schema dan query hanya metadata akun, akses, feedback, kampanye, log admin; klaim README konsisten.
- **Gate login tidak membocorkan data:** sebelum auth hanya form login; tidak ada render tabel/metric.
- **`.env*` di-ignore**, `.env.example` tanpa nilai.

---

## 5. Tidak Bisa Diuji (Blocked — Bukan "Lulus")

1. Alur UI setelah login dan semua callable: butuh akun admin; kredensial tidak diminta dan tidak ditebak.
2. Firestore Rules unit test & emulator Functions: `functions/node_modules` tidak ada; instalasi dependency dilarang.
3. `npm run build` baru: menulis ulang `dist` (melanggar read-only). Artifact 21:17 hanya bukti tidak langsung.
4. Integrasi Mobile App — penentu sebenarnya apakah F-01/F-02 sudah tertutup di sisi lain. **Belum ada bukti.**
5. Audit aksesibilitas otomatis (axe/Lighthouse) dan uji visual 360px: hanya inspeksi CSS + hitung kontras manual.
6. Regresi versi ter-deploy: tidak ada git, jadi tidak bisa memastikan `dist` = source sekarang.

---

## 6. Risiko Sisa & Urutan Aksi

1. Perjelas kontrak enforcement akses (**F-01**) — ini penentu GO/NO-GO.
2. Tutup downgrade trial (**F-02**) + test guard.
3. Putuskan kesegaran `status` (**F-03**) dan serialisasi mutasi kampanye (**F-04**).
4. Batch log + idempotency (**F-05**), pagination/retensi (**F-06**), pisahkan config sensitif (**F-07**).
5. Guard konfigurasi & UX waktu (**F-08**, **F-09**).
6. Perbaikan a11y (**F-10**, **F-17**), triage dependensi (**F-11**).
7. Proses rilis: VCS + tag, test minimal, `.firebaserc`, predeploy build (**F-12**, **F-13**).

---

## 7. Catatan Auditor

Yang saya lewati: login nyata, emulator rules/functions, dan build bersih — butuh kredensial/instalasi/tulis file, di luar batas read-only.

Risiko utama: **F-01/F-02 bisa berubah tingkat jika Mobile App terbukti menegakkan dan melindungi keduanya**. Sampai itu dibuktikan, statusnya tetap release-blocking.

*Rigel — QA & Release Engineer. Laporan ini hasil verifikasi independen read-only, bukan implementasi.*
