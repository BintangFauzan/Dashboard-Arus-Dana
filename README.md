# Arus Dana Admin Dashboard

Dashboard internal Founder/admin berbasis React, Vite, dan JavaScript.
Logika navigasi serta filter UI dikelola melalui React Context.

## Menjalankan

```sh
npm install
npm run dev
```

Pemeriksaan proyek:

```sh
npm run lint
npm run build
```

## Status integrasi

Firebase Authentication email/password sudah disiapkan sebagai gerbang login.
Dashboard hanya mengizinkan UID pada `VITE_FIREBASE_ADMIN_UID`. Cloud Functions
memeriksa UID yang sama melalui `ADMIN_UID` pada `functions/.env`, dan
Firestore Rules membatasi akses admin ke UID tersebut. Pemeriksaan frontend
hanya untuk UX; backend dan Rules tetap menegakkan allowlist. Pendaftaran akun
tidak tersedia di browser.

### Menyiapkan Firebase Web App

1. Daftarkan Web App pada Firebase project yang dipakai dashboard dan Mobile App.
2. Aktifkan Email/Password di Firebase Authentication.
3. Salin `.env.example` menjadi `.env.local`, lalu isi nilai dari konfigurasi
   Firebase Web App (`apiKey`, `authDomain`, `projectId`, dan `appId`).
4. Isi `VITE_FIREBASE_ADMIN_UID` dengan UID akun di `.env.local`; salin UID yang
   sama ke `ADMIN_UID` pada `functions/.env` berdasarkan `functions/.env.example`.
   UID tersebut juga menjadi allowlist admin di `firestore.rules`, jadi sinkronkan
   aturan bila UID admin diganti. Custom claim tidak digunakan.

   ```powershell
   Copy-Item functions\.env.example functions\.env
   ```

   Setelah menyalin, isi `ADMIN_UID` di `functions/.env` dengan nilai yang sama
   seperti `VITE_FIREBASE_ADMIN_UID`.

5. Aktifkan metode Email/Password di Firebase Authentication dan login dengan akun
   yang UID-nya dikonfigurasi.

Jangan masukkan service-account key atau kredensial Firebase Admin SDK ke
`.env.local`, browser, atau repository. `.env.local` dan `functions/.env`
diabaikan oleh Git. UID bukan secret, tetapi Rules dan Functions harus memakai
UID yang sama.

Jangan deploy ke project produksi sebelum allowlist UID, Rules, Functions,
indexes, dan test emulator diverifikasi.

Implementasi backend tersedia pada `firestore.rules`, `firestore.indexes.json`,
dan folder `functions`. Kontrak data dan integrasi Mobile App ada di
`BACKEND_SCHEMA.md`. Dokumen penerima `config/inAppNotificationTargets` admin-only;
Mobile App menggunakan callable `getInAppNotificationConfig` agar daftar UID
tidak dapat dibaca pengguna lain.

## Pemeriksaan dan emulator

```sh
npm run lint
npm test
npm run test:rules
npm run test:emulator
npm run build
npm --prefix functions run lint
npm --prefix functions test
npm run emulators -- --project demo-arus-dana
```

`test:rules` dan `test:emulator` menjalankan Emulator Suite sementara dengan
project demo; data tes tidak dikirim ke Firebase Cloud. `test:emulator` menguji
callable autentikasi dan menjalankan handler rekonsiliasi terhadap Firestore
emulator. Saat menjalankan aplikasi manual, emulator memakai project demo
terpisah; jangan mengisi kredensial produksi pada `.env.local` saat
`VITE_USE_FIREBASE_EMULATOR=true`.

Listener dashboard membatasi pembacaan awal hingga 50 dokumen per koleksi.
Gunakan tombol “Muat 50 data berikutnya” untuk menjelajah halaman berikutnya;
pencarian dan filter berlaku pada dokumen yang sudah dimuat. Kartu analytics
menandai metrik berbasis sampel agar tidak disalahartikan sebagai total koleksi.

Sebelum rilis, tentukan project staging dan produksi, lalu deploy hanya melalui
script yang menolak target yang tidak dinyatakan eksplisit. Contoh PowerShell:

```powershell
$env:FIREBASE_TARGET_PROJECT_ID = "<firebase-project-id-yang-dikonfirmasi>"
npm run deploy
```

Untuk hanya deploy Functions dan Rules, jalankan
`npm --prefix functions run deploy` dengan variabel yang sama. Predeploy akan
membandingkan target eksplisit dengan project yang dipilih Firebase CLI dan
menolak project demo. Project alias belum dibuat karena ID staging/produksi
belum dikonfirmasi; jangan menjalankan deploy langsung di luar script ini.

### Memuat data demo (opsional)

Seeder hanya menulis data dengan ID demo, menolak menimpa dokumen yang bukan
data demo, mempertahankan dokumen konfigurasi yang sudah ada, dan tidak membuat
akun Authentication. Seeder menulis ke Firebase Cloud, jadi pastikan project ID
sesuai dengan `VITE_FIREBASE_PROJECT_ID` sebelum menjalankannya:

```sh
cd functions
npm run seed:demo -- --project-id <firebase-project-id> --confirm-project-id <firebase-project-id>
```

Kedua nilai project ID wajib sama sebagai konfirmasi eksplisit. Seeder tidak
dijalankan otomatis dan tidak boleh diarahkan ke project yang belum diperiksa.

Payments tetap nonaktif. Dashboard tidak membaca ledger keuangan pengguna.
