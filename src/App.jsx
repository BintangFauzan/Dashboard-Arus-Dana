import { useState } from 'react'
import { useDashboard } from './context/dashboardContext'
import { dashboardPages } from './context/dashboardPages'
import { useAuth } from './context/authContext'
import { useDashboardData } from './context/dataContext'
import DashboardPages from './DashboardPages'
import { getCampaignStatus } from './campaignUtils'
import './App.css'

const pageContent = {
  overview: {
    eyebrow: 'Ringkasan operasional',
    title: 'Overview',
    description: 'Pantau penggunaan Arus Dana tanpa mengakses data keuangan pengguna.',
  },
  users: {
    eyebrow: 'Akun pengguna',
    title: 'Users',
    description: 'Kelola metadata akun minimum dan tinjau status akses efektif.',
  },
  access: {
    eyebrow: 'Kebijakan akses',
    title: 'Access & Campaigns',
    description: 'Atur default akses AI, trial, dan kampanye gratis berbatas tanggal.',
  },
  feedback: {
    eyebrow: 'Suara pengguna',
    title: 'Feedback',
    description: 'Baca masukan yang dikirim pengguna secara sadar dan kelola status tinjauan.',
  },
  notices: {
    eyebrow: 'Komunikasi aplikasi',
    title: 'In-app Notices',
    description: 'Konfigurasikan pemberitahuan akses yang muncul di dalam Mobile App.',
  },
  prompts: {
    eyebrow: 'Pengaturan umpan balik',
    title: 'Feedback Prompts',
    description: 'Atur jadwal prompt feedback berkala untuk Mobile App.',
  },
  analytics: {
    eyebrow: 'Metrik non-keuangan',
    title: 'Analytics',
    description: 'Tinjau metrik operasional non-keuangan yang tersedia dari Firestore.',
  },
  activity: {
    eyebrow: 'Jejak administrasi',
    title: 'Admin Activity',
    description: 'Riwayat tindakan administratif yang dilakukan Founder/admin.',
  },
}

function formatTimestamp(value) {
  if (!value) return '—'
  const date = value.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date)
}

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    key: <><circle cx="8" cy="15" r="5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" /></>,
    message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-5 5" /></>,
    activity: <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function Sidebar() {
  const { activePage, setActivePage } = useDashboard()

  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={() => setActivePage('overview')}>
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="brand-copy">
          <strong>arus dana</strong>
          <small>ADMIN DASHBOARD</small>
        </span>
      </a>

      <div className="nav-label">WORKSPACE</div>
      <nav className="primary-nav" aria-label="Navigasi dashboard">
        {dashboardPages.map((page) => (
          <button
            className={`nav-item${activePage === page.id ? ' is-active' : ''}`}
            aria-current={activePage === page.id ? 'page' : undefined}
            key={page.id}
            onClick={() => setActivePage(page.id)}
            type="button"
          >
            <Icon name={page.icon} />
            <span>{page.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <span className="sidebar-note-icon"><Icon name="shield" size={17} /></span>
          <div>
            <strong>Data tetap privat</strong>
            <p>Dashboard tidak mengakses ledger keuangan pengguna.</p>
          </div>
        </div>
        <div className="sidebar-version">
          <span className="status-indicator" />
          <span>Workspace Arus Dana</span>
          <span className="version-tag">MVP</span>
        </div>
      </div>
    </aside>
  )
}

function PageHeader({ page }) {
  const { user, signOut } = useAuth()
  const [signOutError, setSignOutError] = useState('')

  async function handleSignOut() {
    setSignOutError('')

    try {
      await signOut()
    } catch {
      setSignOutError('Tidak dapat keluar. Coba lagi.')
    }
  }

  return (
    <header className="page-header">
      <div className="breadcrumb">
        <span>Dashboard</span>
        <span className="breadcrumb-divider">/</span>
        <span className="breadcrumb-current">{page.title}</span>
      </div>
      <div className="header-actions">
        <span className="connection-pill">
          <span className="connection-dot" />
          Admin terverifikasi
        </span>
        <span className="admin-email">{user?.email}</span>
        <button className="sign-out-button" onClick={handleSignOut} type="button">Keluar</button>
        {signOutError && <span className="sign-out-error" role="alert">{signOutError}</span>}
      </div>
    </header>
  )
}

function SetupNotice() {
  const { dataErrors, isLoading } = useDashboardData()
  const hasErrors = dataErrors.length > 0
  const title = isLoading
    ? 'Menghubungkan data operasional'
    : hasErrors
      ? 'Sebagian data belum dapat dimuat'
      : 'Data operasional terhubung'
  const description = isLoading
    ? 'Dashboard sedang membaca data dari Firestore.'
    : hasErrors
      ? dataErrors.join(' ')
      : 'Subscription Firestore aktif. Perubahan administratif dikirim melalui Cloud Functions.'

  return (
    <section className="setup-notice" aria-label="Status persiapan integrasi">
      <span className="notice-icon"><Icon name="lock" size={18} /></span>
      <div className="notice-copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <span className="notice-tag">{isLoading ? 'MEMUAT' : hasErrors ? 'PERLU DICEK' : 'FIRESTORE AKTIF'}</span>
    </section>
  )
}

function OverviewPage() {
  const {
    users,
    feedback,
    campaigns,
    activity,
    isLoading,
    dataErrors,
    referenceTime,
    hasMore,
  } = useDashboardData()
  const { setActivePage } = useDashboard()
  const activeUsersCount = users.filter((user) => {
    if (!user.lastSeenAt) return false
    const lastSeen = user.lastSeenAt.toDate ? user.lastSeenAt.toDate() : new Date(user.lastSeenAt)
    const age = (referenceTime || 0) - lastSeen.getTime()
    return Number.isFinite(lastSeen.getTime()) && age >= 0 && age <= 7 * 24 * 60 * 60 * 1000
  }).length
  const newFeedbackCount = feedback.filter((item) => item.status === 'new').length
  const activeCampaignCount = campaigns.filter(
    (item) => getCampaignStatus(item, referenceTime || 0) === 'active',
  ).length
  const systemStatus = isLoading
    ? 'Memeriksa'
    : dataErrors.length > 0
      ? 'Perlu dicek'
      : 'Data Firestore aktif'
  return (
    <>
      <div className="overview-grid">
        <article className="metric-card">
          <div className="metric-heading">
            <span>Akun dimuat</span>
            <span className="metric-icon lavender"><Icon name="users" /></span>
          </div>
          <div className="metric-value">{users.length}</div>
          <div className="metric-footnote">{hasMore.users ? 'Data terbaru · ada halaman berikutnya' : users.length > 0 ? 'Metadata akun minimum tersedia' : 'Belum ada data pengguna'}</div>
        </article>
        <article className="metric-card">
          <div className="metric-heading">
            <span>Aktif 7 hari</span>
            <span className="metric-icon mint"><Icon name="activity" /></span>
          </div>
          <div className="metric-value">{activeUsersCount}</div>
          <div className="metric-footnote">{hasMore.users ? 'Dari akun yang dimuat' : 'Berdasarkan aktivitas terakhir pengguna'}</div>
        </article>
        <article className="metric-card">
          <div className="metric-heading">
            <span>Feedback baru</span>
            <span className="metric-icon peach"><Icon name="message" /></span>
          </div>
          <div className="metric-value">{newFeedbackCount}</div>
          <div className="metric-footnote">{hasMore.feedback ? 'Dari feedback yang dimuat' : newFeedbackCount > 0 ? 'Feedback berstatus baru' : 'Tidak ada feedback baru'}</div>
        </article>
        <article className="metric-card">
          <div className="metric-heading">
            <span>Kampanye berjalan</span>
            <span className="metric-icon blue"><Icon name="key" /></span>
          </div>
          <div className="metric-value">{activeCampaignCount}</div>
          <div className="metric-footnote">{activeCampaignCount > 0 ? 'Kampanye berstatus aktif' : 'Tidak ada kampanye aktif'}</div>
        </article>
      </div>

      <div className="overview-bottom">
        <section className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-eyebrow">Aktivitas terbaru</span>
              <h2>Ringkasan aktivitas</h2>
            </div>
            <button type="button" className="text-button" onClick={() => setActivePage('activity')}>
              Lihat semua <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="empty-state">
            {activity.length === 0 ? (
              <>
                <span className="empty-illustration"><Icon name="activity" size={23} /></span>
                <strong>Belum ada data untuk ditampilkan</strong>
                <p>Aktivitas akan muncul setelah tindakan administratif dilakukan melalui dashboard.</p>
              </>
            ) : (
              <div className="overview-activity-list">
                {activity.slice(0, 4).map((item) => (
                  <div className="overview-activity-row" key={item.id}>
                    <span>{formatTimestamp(item.createdAt)}</span>
                    <strong>{item.summary}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel system-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-eyebrow">Kesiapan sistem</span>
              <h2>Status integrasi</h2>
            </div>
            <span className="status-label"><span className={`status-dot${dataErrors.length ? ' pending' : ''}`} />{systemStatus}</span>
          </div>
          <div className="system-list">
            <div className="system-row">
              <span className="system-service"><span className="service-symbol firebase-symbol">F</span> Firebase Auth</span>
              <span className="system-pending">Email/password · UID admin cocok</span>
            </div>
            <div className="system-row">
              <span className="system-service"><span className="service-symbol firestore-symbol">D</span> Firestore</span>
              <span className="system-pending">{isLoading ? 'Membaca data...' : dataErrors.length ? 'Ada sumber data gagal dibaca' : 'Subscription berhasil dibuka'}</span>
            </div>
            <div className="system-row">
              <span className="system-service"><span className="service-symbol functions-symbol">ƒ</span> Cloud Functions</span>
              <span className="system-pending">Operasi tersedia · uji fungsi menunggu</span>
            </div>
            <div className="system-row">
              <span className="system-service"><span className="service-symbol analytics-symbol">A</span> Analytics</span>
              <span className="system-pending">Metrik operasional Firestore</span>
            </div>
          </div>
          <div className="system-footnote">
            <Icon name="shield" size={15} />
            <span>Tidak ada data keuangan pengguna yang dimuat.</span>
          </div>
        </section>
      </div>
    </>
  )
}

function PaymentsDisabled() {
  return (
    <div className="payments-disabled">
      <span className="payments-lock"><Icon name="lock" size={15} /></span>
      <span>Payments nonaktif</span>
    </div>
  )
}

function App() {
  const { activePage } = useDashboard()
  const page = pageContent[activePage] ?? pageContent.overview

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-area">
        <PageHeader page={page} />
        <div className="page-content">
          <div className="page-intro">
            <div>
              <span className="page-eyebrow">{page.eyebrow}</span>
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
            <PaymentsDisabled />
          </div>
          <SetupNotice />
          {activePage === 'overview'
            ? <OverviewPage />
            : <DashboardPages pageId={activePage} />}
          <footer className="page-footer">
            <span>Arus Dana Dashboard <span className="footer-separator">·</span> Area internal Founder/admin</span>
            <span>Data keuangan pengguna tidak ditampilkan</span>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App
