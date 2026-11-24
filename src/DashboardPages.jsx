import { useState } from 'react'
import { useDashboardData } from './context/dataContext'
import { callCloudFunction } from './firebase'
import {
  formatCampaignPeriod,
  getCampaignStatus,
  toJakartaDateInput,
  toJakartaInclusiveEndInput,
} from './campaignUtils'
import './DashboardPages.css'

const pendingRequestIds = new Map()

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

function getCampaignStatusLabel(campaign, now) {
  const labels = {
    active: 'Aktif',
    scheduled: 'Terjadwal',
    expired: 'Selesai',
    paused: 'Nonaktif',
    ended: 'Diakhiri',
    invalid: 'Tanggal tidak valid',
  }
  return labels[getCampaignStatus(campaign, now)] || '—'
}

async function callFunction(name, payload) {
  const requestKey = `${name}:${JSON.stringify(payload)}`
  const requestId = pendingRequestIds.get(requestKey) || globalThis.crypto.randomUUID()
  pendingRequestIds.set(requestKey, requestId)
  const response = await callCloudFunction({
    functionName: name,
    body: { ...payload, requestId },
    requiresIdToken: true,
  })
  pendingRequestIds.delete(requestKey)
  return response
}

function PagePanel({ eyebrow, title, action, children, className = '' }) {
  return (
    <section className={`page-panel ${className}`}>
      <div className="page-panel-heading">
        <div>
          <span className="panel-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyTable({ columns, title, description }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
      </table>
      <div className="table-empty">
        <span className="table-empty-icon">—</span>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  )
}

function LoadMoreButton({ hasMore, isLoading, onClick }) {
  if (!hasMore) return null

  return (
    <div className="page-more">
      <button className="button-muted" disabled={isLoading} onClick={onClick} type="button">
        {isLoading ? 'Memuat...' : 'Muat 50 data berikutnya'}
      </button>
      <span>Pencarian dan filter berlaku pada data yang sudah dimuat.</span>
    </div>
  )
}

function UsersPage() {
  const {
    userSearch,
    setUserSearch,
    userAccessFilter,
    setUserAccessFilter,
    users,
    access,
    activity,
    campaigns,
    hasMore,
    loadingMore,
    loadMoreUsers,
  } = useDashboardData()

  const queryText = userSearch.trim().toLowerCase()
  const visibleUsers = users.filter((user) => {
    const matchesSearch = !queryText
      || user.id.toLowerCase().includes(queryText)
      || String(user.email || '').toLowerCase().includes(queryText)
    const effectiveStatus = access[user.id]?.effectiveStatus || '—'
    const matchesAccess = userAccessFilter === 'all'
      || effectiveStatus === userAccessFilter
    return matchesSearch && matchesAccess
  })

  return (
    <PagePanel
      eyebrow="Direktori akun"
      title="Semua pengguna"
      action={<span className="result-count">{visibleUsers.length} cocok · {users.length} dimuat</span>}
      className="records-panel"
    >
      <div className="table-toolbar">
        <label className="search-field">
          <SearchIcon />
          <input
            aria-label="Cari berdasarkan UID atau email"
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Cari UID atau email..."
            value={userSearch}
          />
        </label>
        <label className="select-field">
          <span>Status akses</span>
          <select
            aria-label="Filter status akses"
            onChange={(event) => setUserAccessFilter(event.target.value)}
            value={userAccessFilter}
          >
            <option value="all">Semua status</option>
            <option value="unlimited">Unlimited</option>
            <option value="date_limited_free">Akses kampanye</option>
            <option value="free_tier">Trial</option>
            <option value="inactive">Inactive</option>
            <option value="active">Active</option>
          </select>
        </label>
      </div>
      {visibleUsers.length === 0 ? (
        <EmptyTable
          columns={['UID', 'Tanggal daftar', 'Aktivitas terakhir', 'Status akses']}
          description="Tidak ada pengguna yang cocok atau koleksi pengguna belum terisi."
          title="Belum ada data pengguna"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{['UID', 'Tanggal daftar', 'Aktivitas terakhir', 'Status akses', 'Riwayat akses'].map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user.id}>
                  <td><code className="uid-cell">{user.id}</code></td>
                  <td>{formatTimestamp(user.createdAt)}</td>
                  <td>{formatTimestamp(user.lastSeenAt)}</td>
                  <td><span className="status-badge">{access[user.id]?.effectiveStatus || '—'}</span></td>
                  <td>
                    <AccessHistory
                      activity={activity}
                      campaigns={campaigns}
                      uid={user.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMoreButton
        hasMore={hasMore.users}
        isLoading={loadingMore.users}
        onClick={loadMoreUsers}
      />
      <p className="data-boundary">Hanya metadata akun minimum yang akan ditampilkan. Ledger keuangan tidak diakses.</p>
    </PagePanel>
  )
}

function AccessHistory({ activity, campaigns, uid }) {
  const history = activity.filter((entry) => {
    if (['update_access_policy', 'update_trial_policy'].includes(entry.type)) return true
    if (!entry.type?.includes('access_campaign')) return false

    const campaign = campaigns.find((item) => item.id === entry.metadata?.campaignId)
    const target = entry.metadata?.target || campaign?.target
    const uids = entry.metadata?.uids || campaign?.uids || []
    return target === 'all_users' || (target === 'selected_users' && uids.includes(uid))
  }).slice(0, 5)

  if (history.length === 0) return '—'

  return (
    <details className="user-access-history">
      <summary>{history.length} perubahan</summary>
      <ul>
        {history.map((entry) => (
          <li key={entry.id}>
            <time>{formatTimestamp(entry.createdAt)}</time>
            <span>{entry.summary}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function AccessPage() {
  const {
    campaigns,
    config,
    referenceTime,
    hasMore,
    loadingMore,
    loadMoreCampaigns,
  } = useDashboardData()
  const [showCampaignForm, setShowCampaignForm] = useState(false)
  const [editingCampaignId, setEditingCampaignId] = useState('')
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    target: 'all_users',
    uids: '',
    startDate: '',
    endDate: '',
    postExpiryStatus: 'inactive',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [trialDraft, setTrialDraft] = useState(null)
  const trialEnabled = trialDraft?.enabled ?? config.trialPolicy?.enabled ?? false
  const trialDurationDays = trialDraft?.durationDays ?? config.trialPolicy?.durationDays ?? 7
  const [trialSaving, setTrialSaving] = useState(false)
  const [trialError, setTrialError] = useState('')

  function openCampaignForm(campaign = null) {
    setEditingCampaignId(campaign?.id || '')
    setCampaignForm(campaign ? {
      name: campaign.name || '',
      target: campaign.target || 'all_users',
      uids: (campaign.uids || []).join('\n'),
      startDate: toJakartaDateInput(campaign.startAt),
      endDate: toJakartaInclusiveEndInput(campaign.endAtExclusive),
      postExpiryStatus: campaign.postExpiryStatus || 'inactive',
    } : {
      name: '',
      target: 'all_users',
      uids: '',
      startDate: '',
      endDate: '',
      postExpiryStatus: 'inactive',
    })
    setError('')
    setShowCampaignForm(true)
  }

  async function submitCampaign(event) {
    event.preventDefault()
    const selectedUids = campaignForm.uids.split(/[\n,\s]+/).filter(Boolean)
    const targetDescription = campaignForm.target === 'all_users'
      ? 'semua pengguna'
      : `${selectedUids.length} UID`
    const actionDescription = editingCampaignId ? 'memperbarui' : 'membuat'
    if (!window.confirm(
      `Konfirmasi ${actionDescription} kampanye untuk ${targetDescription} pada ${campaignForm.startDate} sampai ${campaignForm.endDate} (Asia/Jakarta). Setelah berakhir: ${campaignForm.postExpiryStatus}. Fitur inti budgeting tetap gratis.`,
    )) return

    setSubmitting(true)
    setError('')
    try {
      const payload = {
        ...campaignForm,
        uids: selectedUids,
        campaignId: editingCampaignId || undefined,
      }
      await callFunction(
        editingCampaignId ? 'updateAccessCampaign' : 'createAccessCampaign',
        payload,
      )
      setShowCampaignForm(false)
      setEditingCampaignId('')
      setCampaignForm({
        name: '',
        target: 'all_users',
        uids: '',
        startDate: '',
        endDate: '',
        postExpiryStatus: 'inactive',
      })
    } catch (submitError) {
      setError(submitError.message || `Kampanye gagal ${editingCampaignId ? 'diperbarui' : 'dibuat'}.`)
    } finally {
      setSubmitting(false)
    }
  }

  async function saveTrialPolicy(event) {
    event.preventDefault()
    if (!window.confirm(
      `Konfirmasi ${trialEnabled ? 'mengaktifkan' : 'menonaktifkan'} trial custom selama ${trialDurationDays} hari. Jika aktif, durasi dimulai saat pengguna pertama kali mengakses AI.`,
    )) return

    setTrialSaving(true)
    setTrialError('')
    try {
      await callFunction('updateTrialPolicy', {
        enabled: trialEnabled,
        durationDays: Number(trialDurationDays),
      })
      setTrialDraft(null)
    } catch (saveError) {
      setTrialError(saveError.message || 'Kebijakan trial gagal disimpan.')
    } finally {
      setTrialSaving(false)
    }
  }

  async function setUnlimitedDefault() {
    if (!window.confirm(
      'Tetapkan default akses AI menjadi unlimited untuk pengguna tanpa override? Hanya akses AI yang berubah; fitur inti budgeting tetap gratis.',
    )) return
    setSubmitting(true)
    setError('')
    try {
      await callFunction('updateAccessPolicy', { defaultStatus: 'unlimited' })
    } catch (submitError) {
      setError(submitError.message || 'Default akses gagal diperbarui.')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleCampaign(campaign) {
    const enabled = campaign.enabled === false
    const status = getCampaignStatusLabel(campaign, Date.now())
    const target = campaign.target === 'all_users'
      ? 'semua pengguna'
      : `${campaign.uids?.length || 0} UID`
    if (!window.confirm(
      `${enabled ? 'Aktifkan' : 'Nonaktifkan'} kampanye "${campaign.name}" (${status})? Target: ${target}. Periode: ${formatCampaignPeriod(campaign)}. Setelah berakhir: ${campaign.postExpiryStatus}. Hanya akses AI yang berubah; fitur inti budgeting tetap gratis.`,
    )) return

    setSubmitting(true)
    setError('')
    try {
      await callFunction('setAccessCampaignEnabled', { campaignId: campaign.id, enabled })
    } catch (actionError) {
      setError(actionError.message || 'Status kampanye gagal diperbarui.')
    } finally {
      setSubmitting(false)
    }
  }

  async function endCampaign(campaign) {
    const target = campaign.target === 'all_users'
      ? 'semua pengguna'
      : `${campaign.uids?.length || 0} UID`
    if (!window.confirm(
      `Akhiri kampanye "${campaign.name}" sekarang? Target: ${target}. Akses AI yang berasal dari kampanye ini dihentikan. Fitur inti budgeting tetap gratis.`,
    )) return

    setSubmitting(true)
    setError('')
    try {
      await callFunction('endAccessCampaign', { campaignId: campaign.id })
    } catch (actionError) {
      setError(actionError.message || 'Kampanye gagal diakhiri.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack">
      <div className="access-summary">
        <div className="summary-icon">AI</div>
        <div>
          <span className="panel-eyebrow">KEBIJAKAN AWAL PRD</span>
          <h2>Default akses: {config.accessPolicy?.defaultStatus || 'belum disimpan'}</h2>
          <p>Fitur inti budgeting tetap gratis.</p>
        </div>
        <button
          className="button-primary"
          disabled={submitting || config.accessPolicy?.defaultStatus === 'unlimited'}
          onClick={setUnlimitedDefault}
          type="button"
        >
          {config.accessPolicy?.defaultStatus === 'unlimited' ? 'Sudah unlimited' : 'Tetapkan unlimited'}
        </button>
      </div>
      {error && <p className="action-error" role="alert">{error}</p>}

      <PagePanel eyebrow="Trial custom" title="Kebijakan masa uji">
        <form className="trial-form" onSubmit={saveTrialPolicy}>
          <label className="toggle-field">
            <input
              checked={trialEnabled}
              onChange={(event) => setTrialDraft((current) => ({
                ...current,
                enabled: event.target.checked,
              }))}
              type="checkbox"
            />
            Aktifkan trial untuk pengguna yang memenuhi syarat
          </label>
          <label className="trial-duration">
            Durasi
            <input
              max="365"
              min="1"
              onChange={(event) => setTrialDraft((current) => ({
                ...current,
                durationDays: event.target.value,
              }))}
              required
              type="number"
              value={trialDurationDays}
            />
            hari
          </label>
          <p>Waktu trial ditetapkan server ketika pengguna pertama kali mengakses AI. Perubahan ini hanya mengatur akses AI.</p>
          {trialError && <p className="action-error" role="alert">{trialError}</p>}
          <button className="button-primary" disabled={trialSaving} type="submit">
            {trialSaving ? 'Menyimpan...' : 'Simpan kebijakan trial'}
          </button>
        </form>
      </PagePanel>

      <PagePanel
        eyebrow="Akses berbatas tanggal"
        title="Kampanye gratis"
        action={(
          <button
            className="button-primary"
            onClick={() => showCampaignForm ? setShowCampaignForm(false) : openCampaignForm()}
            type="button"
          >
            {showCampaignForm ? 'Tutup formulir' : '+ Buat kampanye'}
          </button>
        )}
        className="records-panel"
      >
        {showCampaignForm && (
          <form className="campaign-form" onSubmit={submitCampaign}>
            <h3>{editingCampaignId ? 'Edit kampanye' : 'Kampanye baru'}</h3>
            <label>Nama kampanye<input required value={campaignForm.name} onChange={(event) => setCampaignForm((value) => ({ ...value, name: event.target.value }))} /></label>
            <label>Target<select value={campaignForm.target} onChange={(event) => setCampaignForm((value) => ({ ...value, target: event.target.value }))}><option value="all_users">Semua pengguna</option><option value="selected_users">UID tertentu</option></select></label>
            {campaignForm.target === 'selected_users' && <label>Daftar UID<textarea required rows="3" value={campaignForm.uids} onChange={(event) => setCampaignForm((value) => ({ ...value, uids: event.target.value }))} /></label>}
            <label>Tanggal mulai<input required type="date" value={campaignForm.startDate} onChange={(event) => setCampaignForm((value) => ({ ...value, startDate: event.target.value }))} /></label>
            <label>Tanggal akhir<input required type="date" value={campaignForm.endDate} onChange={(event) => setCampaignForm((value) => ({ ...value, endDate: event.target.value }))} /></label>
            <label>Setelah berakhir<select value={campaignForm.postExpiryStatus} onChange={(event) => setCampaignForm((value) => ({ ...value, postExpiryStatus: event.target.value }))}><option value="inactive">Inactive</option><option value="free_tier">Trial aktif</option><option value="unlimited">Unlimited</option></select></label>
            <div className="campaign-form-actions">
              <button className="button-primary" disabled={submitting} type="submit">{submitting ? 'Menyimpan...' : 'Konfirmasi & simpan'}</button>
              <button className="button-muted" onClick={() => { setShowCampaignForm(false); setEditingCampaignId('') }} type="button">Batal</button>
            </div>
          </form>
        )}
        {error && <p className="action-error" role="alert">{error}</p>}
        <div className="campaign-hints">
          <span>Target: semua pengguna atau UID tertentu</span>
          <span>Zona waktu: Asia/Jakarta</span>
          <span>Akhir tanggal bersifat inklusif</span>
        </div>
        {campaigns.length === 0 ? (
          <EmptyTable
            columns={['Nama kampanye', 'Target', 'Periode', 'Setelah berakhir', 'Status', 'Aksi']}
            description="Belum ada kampanye tersimpan."
            title="Belum ada kampanye"
          />
        ) : (
          <div className="table-wrap campaign-table-wrap">
            <table className="data-table campaign-table">
              <thead><tr>{['Nama kampanye', 'Target', 'Periode', 'Setelah berakhir', 'Status', 'Aksi'].map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{campaign.name}</td>
                    <td>{campaign.target === 'all_users' ? 'Semua pengguna' : `${campaign.uids?.length || 0} UID`}</td>
                    <td>{formatCampaignPeriod(campaign)}</td>
                    <td>{campaign.postExpiryStatus}</td>
                    <td>{getCampaignStatusLabel(campaign, referenceTime || 0)}</td>
                    <td className="campaign-actions">
                      <button
                        className="button-primary"
                        disabled={submitting || getCampaignStatus(campaign, referenceTime || 0) === 'ended'}
                        onClick={() => openCampaignForm(campaign)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="button-muted"
                        disabled={submitting || (campaign.enabled === false && ['expired', 'ended'].includes(getCampaignStatus(campaign, referenceTime || 0)))}
                        onClick={() => toggleCampaign(campaign)}
                        type="button"
                      >
                        {campaign.enabled === false ? 'Aktifkan' : 'Nonaktifkan'}
                      </button>
                      <button
                        className="button-muted"
                        disabled={submitting || ['expired', 'ended'].includes(getCampaignStatus(campaign, referenceTime || 0))}
                        onClick={() => endCampaign(campaign)}
                        type="button"
                      >
                        Akhiri
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMoreButton
          hasMore={hasMore.campaigns}
          isLoading={loadingMore.campaigns}
          onClick={loadMoreCampaigns}
        />
      </PagePanel>

      <div className="security-callout">
      Semua perubahan akses divalidasi server-side, menampilkan dampak sebelum dikonfirmasi, dan dikirim hanya melalui Cloud Functions.
      </div>
    </div>
  )
}

function FeedbackPage() {
  const {
    feedbackFilter,
    setFeedbackFilter,
    feedbackSearch,
    setFeedbackSearch,
    feedback,
    referenceTime,
    hasMore,
    loadingMore,
    loadMoreFeedback,
    updateFeedbackStatus,
  } = useDashboardData()
  const [updating, setUpdating] = useState('')
  const [error, setError] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState('all')

  const queryText = feedbackSearch.trim().toLowerCase()
  const categories = [...new Set(feedback.map((item) => item.category).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second, 'id'))
  const now = referenceTime ?? 0
  const visibleFeedback = feedback.filter((item) => {
    const matchesStatus = feedbackFilter === 'all' || item.status === feedbackFilter
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter
    const matchesSearch = !queryText
      || String(item.uid || '').toLowerCase().includes(queryText)
      || String(item.category || '').toLowerCase().includes(queryText)
      || String(item.message || '').toLowerCase().includes(queryText)
    const createdAt = item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt)
    const age = now - createdAt.getTime()
    const days = Number(timeFilter)
    const matchesTime = timeFilter === 'all'
      || (Number.isFinite(age) && age >= 0 && age <= days * 24 * 60 * 60 * 1000)
    return matchesStatus && matchesCategory && matchesSearch && matchesTime
  })

  async function updateStatus(feedbackId, status) {
    setUpdating(feedbackId)
    setError('')
    try {
      await callFunction('updateFeedbackReview', { feedbackId, status })
      updateFeedbackStatus(feedbackId, status)
    } catch (submitError) {
      setError(submitError.message || 'Status feedback gagal diperbarui.')
    } finally {
      setUpdating('')
    }
  }

  return (
    <PagePanel
      eyebrow="Kotak masuk"
      title="Masukan pengguna"
      action={<span className="result-count">{visibleFeedback.length} cocok · {feedback.length} dimuat</span>}
      className="records-panel"
    >
      <div className="table-toolbar">
        <label className="search-field">
          <SearchIcon />
          <input
            aria-label="Cari UID, kategori, atau isi feedback"
            onChange={(event) => setFeedbackSearch(event.target.value)}
            placeholder="Cari UID atau isi feedback..."
            value={feedbackSearch}
          />
        </label>
        <label className="select-field">
          <span>Status tinjauan</span>
          <select
            aria-label="Filter status feedback"
            onChange={(event) => setFeedbackFilter(event.target.value)}
            value={feedbackFilter}
          >
            <option value="all">Semua status</option>
            <option value="new">Baru</option>
            <option value="reviewing">Sedang ditinjau</option>
            <option value="reviewed">Selesai ditinjau</option>
          </select>
        </label>
        <label className="select-field">
          <span>Kategori</span>
          <select
            aria-label="Filter kategori feedback"
            onChange={(event) => setCategoryFilter(event.target.value)}
            value={categoryFilter}
          >
            <option value="all">Semua kategori</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label className="select-field">
          <span>Periode</span>
          <select
            aria-label="Filter periode feedback"
            onChange={(event) => setTimeFilter(event.target.value)}
            value={timeFilter}
          >
            <option value="all">Semua waktu</option>
            <option value="7">7 hari terakhir</option>
            <option value="30">30 hari terakhir</option>
          </select>
        </label>
      </div>
      {error && <p className="action-error" role="alert">{error}</p>}
      {visibleFeedback.length === 0 ? (
        <EmptyTable
          columns={['Dikirim', 'UID', 'Kategori', 'Isi feedback', 'Status']}
          description="Tidak ada feedback yang cocok atau koleksi feedback belum terisi."
          title="Belum ada feedback"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{['Dikirim', 'UID', 'Kategori', 'Isi feedback', 'Status'].map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {visibleFeedback.map((item) => (
                <tr key={item.id}>
                  <td>{formatTimestamp(item.createdAt)}</td>
                  <td><code className="uid-cell">{item.uid}</code></td>
                  <td>{item.category || '—'}</td>
                  <td className="feedback-message">{item.message || '—'}</td>
                  <td>
                    <select
                      aria-label={`Status feedback ${item.id}`}
                      className="row-select"
                      disabled={updating === item.id}
                      onChange={(event) => updateStatus(item.id, event.target.value)}
                      value={item.status || 'new'}
                    >
                      <option value="new">Baru</option>
                      <option value="reviewing">Sedang ditinjau</option>
                      <option value="reviewed">Selesai ditinjau</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMoreButton
        hasMore={hasMore.feedback}
        isLoading={loadingMore.feedback}
        onClick={loadMoreFeedback}
      />
      <p className="data-boundary">Konteks transaksi atau saldo tidak akan ditambahkan ke feedback.</p>
    </PagePanel>
  )
}

function NoticesPage() {
  const { config } = useDashboardData()
  const [draft, setDraft] = useState(null)
  const enabled = draft?.enabled ?? config.inAppNotifications?.enabled ?? true
  const expiryReminderEnabled = draft?.expiryReminderEnabled
    ?? config.inAppNotifications?.expiryReminderEnabled
    ?? true
  const target = draft?.target ?? config.inAppNotifications?.target ?? 'all_users'
  const uids = draft?.uids
    ?? (config.inAppNotificationTargets?.uids || config.inAppNotifications?.uids || []).join('\n')
  const savedMessages = config.inAppNotifications?.messages || {}
  const messages = draft?.messages || {
    accessChanged: savedMessages.accessChanged
      ?? config.inAppNotifications?.message
      ?? 'Status akses AI Anda berubah menjadi {status}.',
    expiryReminder: savedMessages.expiryReminder
      ?? 'Akses AI Anda akan berakhir pada {endDate} ({timezone}).',
    accessEnded: savedMessages.accessEnded
      ?? 'Akses AI Anda berakhir pada {endDate} ({timezone}).',
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateMessage(key, value) {
    setDraft((current) => ({
      ...current,
      messages: { ...(current?.messages || messages), [key]: value },
    }))
  }

  async function saveNotices(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const selectedUids = uids.split(/[\n,\s]+/).filter(Boolean)
      await callFunction('updateNoticeConfig', {
        enabled,
        expiryReminderEnabled,
        target,
        uids: selectedUids,
        messages,
      })
      setDraft(null)
    } catch (submitError) {
      setError(submitError.message || 'Konfigurasi pemberitahuan gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-stack">
      <form onSubmit={saveNotices}>
      <PagePanel eyebrow="Konfigurasi aplikasi" title="Pemberitahuan akses">
        <div className="setting-list">
          <div className="setting-row">
            <div><strong>Pemberitahuan akses</strong><p>Pop-up saat status akses AI berubah.</p></div>
            <label className="toggle-field"><input checked={enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /><span>Notifikasi aktif</span></label>
          </div>
          <div className="setting-row">
            <div><strong>Pengingat sebelum akses berakhir</strong><p>Pengingat opsional untuk akses berbatas tanggal.</p></div>
            <label className="toggle-field">
              <input checked={expiryReminderEnabled} onChange={(event) => setDraft((current) => ({ ...current, expiryReminderEnabled: event.target.checked }))} type="checkbox" />
              <span>Pengingat aktif</span>
            </label>
          </div>
        </div>
        <div className="field-preview notice-target">
          <label htmlFor="notice-target">Target penerima</label>
          <select
            id="notice-target"
            onChange={(event) => setDraft((current) => ({ ...current, target: event.target.value }))}
            value={target}
          >
            <option value="all_users">Semua pengguna</option>
            <option value="selected_users">UID tertentu</option>
          </select>
          {target === 'selected_users' && (
            <label htmlFor="notice-uids">
              Daftar UID penerima
              <textarea
                id="notice-uids"
                required
                rows="3"
                value={uids}
                onChange={(event) => setDraft((current) => ({ ...current, uids: event.target.value }))}
              />
            </label>
          )}
          <p className="notice-template-hint">
            Placeholder yang dapat dipakai pada pesan: {'{status}'}, {'{endDate}'}, {'{timezone}'}.
          </p>
        </div>
        {[
          ['accessChanged', 'Pesan saat akses AI berubah'],
          ['expiryReminder', 'Pesan pengingat sebelum akses berakhir'],
          ['accessEnded', 'Pesan saat akses AI berakhir'],
        ].map(([key, label]) => (
          <div className="field-preview" key={key}>
            <label htmlFor={`notice-${key}`}>{label}</label>
            <textarea
              id={`notice-${key}`}
              maxLength="500"
              required
              rows="3"
              value={messages[key]}
              onChange={(event) => updateMessage(key, event.target.value)}
            />
            <span>{messages[key].length}/500 karakter</span>
          </div>
        ))}
        {error && <p className="action-error" role="alert">{error}</p>}
        <button className="button-primary form-save" disabled={saving} type="submit">{saving ? 'Menyimpan...' : 'Simpan pemberitahuan'}</button>
      </PagePanel>
      </form>
      <div className="security-callout">
        Konfigurasi tersimpan di backend; penayangan menunggu integrasi Mobile App. Pop-up bukan push notification OS.
      </div>
    </div>
  )
}

function PromptsPage() {
  const { config } = useDashboardData()
  const [draft, setDraft] = useState(null)
  const enabled = draft?.enabled ?? config.feedbackPrompts?.enabled ?? true
  const initialDelayDays = draft?.initialDelayDays ?? config.feedbackPrompts?.initialDelayDays ?? 2
  const cooldownHours = draft?.cooldownHours ?? config.feedbackPrompts?.cooldownHours ?? 48
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function savePrompts(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        enabled,
        initialDelayDays: Number(initialDelayDays),
        cooldownHours: Number(cooldownHours),
      }
      await callFunction('updateFeedbackPromptConfig', payload)
      setDraft(null)
    } catch (submitError) {
      setError(submitError.message || 'Konfigurasi prompt gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-stack">
      <form onSubmit={savePrompts}>
      <PagePanel eyebrow="Konfigurasi aplikasi" title="Jadwal prompt feedback">
        <div className="setting-list">
          <div className="setting-row">
            <div><strong>Prompt feedback berkala</strong><p>Nilai awal yang direkomendasikan pada PRD.</p></div>
            <label className="toggle-field"><input checked={enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /><span>Aktif</span></label>
          </div>
        </div>
        <div className="prompt-values">
          <div className="prompt-value">
            <span>Penundaan awal</span>
            <label><input min="0" max="30" type="number" value={initialDelayDays} onChange={(event) => setDraft((current) => ({ ...current, initialDelayDays: event.target.value }))} /><small> hari</small></label>
            <p>Sejak aktivasi/penggunaan pertama sesuai definisi backend.</p>
          </div>
          <div className="prompt-value">
            <span>Interval antar-prompt</span>
            <label><input min="1" max="720" type="number" value={cooldownHours} onChange={(event) => setDraft((current) => ({ ...current, cooldownHours: event.target.value }))} /><small> jam</small></label>
            <p>Cooldown dimulai ulang setelah prompt ditutup atau feedback dikirim.</p>
          </div>
        </div>
        {error && <p className="action-error" role="alert">{error}</p>}
        <button className="button-primary form-save" disabled={saving} type="submit">{saving ? 'Menyimpan...' : 'Simpan jadwal prompt'}</button>
      </PagePanel>
      </form>
      <div className="security-callout">
        Pengaturan tersimpan di backend; jadwal tampil di dalam aplikasi setelah integrasi Mobile App.
      </div>
    </div>
  )
}

function AnalyticsPage() {
  const { users, access, campaigns, feedback, referenceTime, hasMore } = useDashboardData()
  const now = new Date(referenceTime || 0)
  const activeRecentUsers = users.filter((user) => {
    if (!user.lastSeenAt) return false
    const lastSeen = user.lastSeenAt.toDate ? user.lastSeenAt.toDate() : new Date(user.lastSeenAt)
    const age = now.getTime() - lastSeen.getTime()
    return Number.isFinite(lastSeen.getTime()) && age >= 0 && age <= 7 * 24 * 60 * 60 * 1000
  }).length
  const activeCampaigns = campaigns.filter(
    (campaign) => getCampaignStatus(campaign, referenceTime || 0) === 'active',
  ).length
  const unrestrictedUsers = Object.values(access).filter((item) => item.effectiveStatus === 'unlimited').length

  return (
    <div className="page-stack">
      <div className="analytics-cards">
        <div className="analytics-card"><span>Akun dimuat</span><strong>{users.length}</strong><small>{hasMore.users ? 'Data terbaru saja' : 'Semua akun tersedia'}</small></div>
        <div className="analytics-card"><span>Aktif 7 hari</span><strong>{activeRecentUsers}</strong><small>Dari akun yang dimuat</small></div>
        <div className="analytics-card"><span>Kampanye berjalan</span><strong>{activeCampaigns}</strong><small>Berstatus active</small></div>
        <div className="analytics-card"><span>Feedback baru</span><strong>{feedback.filter((item) => item.status === 'new').length}</strong><small>{hasMore.feedback ? 'Dari feedback yang dimuat' : 'Dari seluruh feedback'}</small></div>
      </div>
      <PagePanel eyebrow="Sumber metrik" title="Analytics non-keuangan">
        <div className="analytics-message">
          <strong>{unrestrictedUsers} akun yang dimuat memiliki status akses unlimited.</strong>
          <p>
            Metrik pengguna dan feedback dihitung dari {users.length} pengguna dan {feedback.length} feedback yang dimuat.
            {hasMore.users || hasMore.feedback ? ' Muat halaman berikutnya untuk memperluas sampel.' : ''}
            {' '}Metrik berasal dari koleksi Firestore users, access, feedback, dan accessCampaigns.
            Aktivitas fitur dan retensi berbasis event Firebase Analytics belum tersedia dari schema ini;
            dashboard tidak mengarang angka dan tidak mengakses ledger.
          </p>
        </div>
      </PagePanel>
    </div>
  )
}

function ActivityPage() {
  const { activity, hasMore, loadingMore, loadMoreActivity } = useDashboardData()
  return (
    <PagePanel
      eyebrow="Audit"
      title="Riwayat tindakan admin"
      action={<span className="result-count">{activity.length} aktivitas dimuat</span>}
      className="records-panel"
    >
      {activity.length === 0 ? (
        <EmptyTable
          columns={['Waktu server', 'Admin UID', 'Tindakan', 'Ringkasan perubahan']}
          description="Log hanya akan tersedia setelah Cloud Functions mencatat tindakan admin."
          title="Belum ada aktivitas"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{['Waktu server', 'Admin UID', 'Tindakan', 'Ringkasan perubahan'].map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {activity.map((item) => (
                <tr key={item.id}>
                  <td>{formatTimestamp(item.createdAt)}</td>
                  <td><code className="uid-cell">{item.adminUid}</code></td>
                  <td>{item.type}</td>
                  <td>{item.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMoreButton
        hasMore={hasMore.activity}
        isLoading={loadingMore.activity}
        onClick={loadMoreActivity}
      />
      <p className="data-boundary">Log tidak menyimpan ledger keuangan, kredensial, atau secret.</p>
    </PagePanel>
  )
}

export default function DashboardPages({ pageId }) {
  const pages = {
    users: UsersPage,
    access: AccessPage,
    feedback: FeedbackPage,
    notices: NoticesPage,
    prompts: PromptsPage,
    analytics: AnalyticsPage,
    activity: ActivityPage,
  }
  const Page = pages[pageId]

  return Page ? <Page /> : null
}
