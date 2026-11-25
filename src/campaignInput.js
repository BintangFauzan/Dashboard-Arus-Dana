function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} wajib diisi.`)
  }
  return value.trim()
}

function requireJakartaDate(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} harus menggunakan format YYYY-MM-DD.`)
  }

  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || year > 9999) {
    throw new Error(`${name} bukan tanggal kalender yang valid.`)
  }
  const calendarDate = new Date(0)
  calendarDate.setUTCFullYear(year, month - 1, day)
  calendarDate.setUTCHours(0, 0, 0, 0)
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) {
    throw new Error(`${name} bukan tanggal kalender yang valid.`)
  }

  return new Date(`${value}T00:00:00+07:00`)
}

export function buildCampaignInput(data, now = Date.now()) {
  const name = requireString(data?.name, 'Nama kampanye')
  if (name.length > 120) {
    throw new Error('Nama kampanye maksimal 120 karakter.')
  }

  const target = requireString(data?.target, 'Target kampanye')
  if (!['all_users', 'selected_users'].includes(target)) {
    throw new Error('Target kampanye tidak valid.')
  }

  if (target === 'selected_users' && !Array.isArray(data?.uids)) {
    throw new Error('Daftar UID target tidak valid.')
  }

  const uids = target === 'selected_users'
    ? [...new Set(data.uids.map((uid) => {
      if (typeof uid !== 'string' || uid.trim().length === 0 || uid.trim().length > 128) {
        throw new Error('Setiap UID target harus berupa teks yang valid.')
      }
      return uid.trim()
    }))] : []
  if (target === 'selected_users' && (uids.length === 0 || uids.length > 500)) {
    throw new Error('Pilih 1–500 UID untuk target tertentu.')
  }

  const startAt = requireJakartaDate(data?.startDate, 'Tanggal mulai')
  const endDate = requireJakartaDate(data?.endDate, 'Tanggal akhir')
  if (endDate.getTime() < startAt.getTime()) {
    throw new Error('Tanggal akhir harus setelah atau sama dengan tanggal mulai.')
  }

  const endAtExclusive = new Date(endDate.getTime() + 24 * 60 * 60 * 1000)
  if (endAtExclusive.getTime() <= now) {
    throw new Error('Tanggal akhir kampanye harus berada di masa depan.')
  }
  const postExpiryStatus = requireString(data?.postExpiryStatus, 'Status setelah kampanye')
  if (!['inactive', 'free_tier', 'unlimited'].includes(postExpiryStatus)) {
    throw new Error('Status setelah kampanye tidak valid.')
  }

  return { name, target, uids, startAt, endAtExclusive, postExpiryStatus }
}

export function targetsOverlap(first, second) {
  if (first.target === 'all_users' || second.target === 'all_users') return true
  const secondUids = new Set(second.uids || [])
  return (first.uids || []).some((uid) => secondUids.has(uid))
}

export function findCampaignConflicts(input, existingCampaigns) {
  return (existingCampaigns || []).filter((campaign) => {
    if (campaign.enabled === false || ['cancelled', 'ended'].includes(campaign.status)) return false
    if (!campaign.startAt || !campaign.endAtExclusive) return false

    const existingStart = campaign.startAt instanceof Date ? campaign.startAt : new Date(campaign.startAt)
    const existingEnd = campaign.endAtExclusive instanceof Date ? campaign.endAtExclusive : new Date(campaign.endAtExclusive)

    const overlapsDates = input.startAt.getTime() < existingEnd.getTime()
      && existingStart.getTime() < input.endAtExclusive.getTime()
    return overlapsDates && targetsOverlap(input, campaign)
  })
}