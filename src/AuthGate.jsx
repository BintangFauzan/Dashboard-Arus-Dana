import { useState } from 'react'
import { firebaseAdminUid, firebaseConfigured, missingFirebaseConfig } from './firebase'
import { useAuth } from './context/authContext'
import './AuthGate.css'

function AuthBrand() {
  return (
    <div className="auth-brand">
      <span className="auth-brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>
        <strong>arus dana</strong>
        <small>ADMIN DASHBOARD</small>
      </span>
    </div>
  )
}

function AuthState({ title, children }) {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-live="polite">
        <AuthBrand />
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  )
}

function LoginPage() {
  const { notice, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signIn(email.trim(), password)
    } catch (authError) {
      if (authError.code === 'auth/invalid-credential') {
        setError('Email atau kata sandi tidak cocok.')
      } else if (authError.code === 'auth/too-many-requests') {
        setError('Terlalu banyak percobaan. Coba lagi beberapa saat.')
      } else if (authError.code === 'auth/operation-not-allowed') {
        setError('Metode Email/Password belum diaktifkan di Firebase Authentication.')
      } else if (authError.code === 'auth/network-request-failed') {
        setError('Tidak dapat terhubung. Periksa koneksi internet Anda.')
      } else {
        setError('Login gagal. Periksa konfigurasi Firebase dan coba lagi.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthState title="Masuk ke dashboard">
      <p className="auth-description">Gunakan akun Founder/admin Arus Dana.</p>
      {notice && <p className="auth-message auth-warning" role="status">{notice}</p>}
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="admin-email">Email</label>
        <input
          autoComplete="username"
          id="admin-email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
        <label htmlFor="admin-password">Kata sandi</label>
        <input
          autoComplete="current-password"
          id="admin-password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <button disabled={submitting} type="submit">
          {submitting ? 'Memeriksa...' : 'Masuk'}
        </button>
      </form>
      <p className="auth-footnote">Pendaftaran akun tidak tersedia dari dashboard.</p>
    </AuthState>
  )
}

export default function AuthGate({ children }) {
  const { status } = useAuth()

  if (!firebaseConfigured || !firebaseAdminUid) {
    const missingConfiguration = firebaseAdminUid
      ? missingFirebaseConfig
      : [...missingFirebaseConfig, 'VITE_FIREBASE_ADMIN_UID']

    return (
      <AuthState title="Konfigurasi Firebase diperlukan">
        <p className="auth-description">
          Buat <code>.env.local</code> di folder dashboard menggunakan nilai dari Firebase Web App
          yang dikonfigurasi untuk dashboard.
        </p>
        <ul className="auth-config-list">
          {missingConfiguration.map((key) => <li key={key}>{key}</li>)}
        </ul>
        <p className="auth-footnote">
          Aktifkan metode Email/Password dan isi UID akun yang diizinkan pada `VITE_FIREBASE_ADMIN_UID`. Jangan gunakan service-account key di web.
        </p>
      </AuthState>
    )
  }

  if (status === 'loading') {
    return (
      <AuthState title="Memeriksa akses">
        <p className="auth-description">Memverifikasi sesi dan hak admin...</p>
        <span className="auth-spinner" aria-label="Memuat" role="status" />
      </AuthState>
    )
  }

  if (status === 'verification-error') {
    return (
      <AuthState title="Akses belum dapat diverifikasi">
        <p className="auth-message auth-error" role="alert">
          Gagal memeriksa sesi admin. Periksa koneksi dan konfigurasi Firebase, lalu muat ulang halaman.
        </p>
        <button className="auth-reload" onClick={() => window.location.reload()} type="button">
          Muat ulang
        </button>
      </AuthState>
    )
  }

  return status === 'signed-in' ? children : <LoginPage />
}
