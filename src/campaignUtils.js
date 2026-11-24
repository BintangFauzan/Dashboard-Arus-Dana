export function getCampaignStatus(campaign, now) {
  if (campaign.status === 'ended' || campaign.status === 'cancelled') return 'ended'

  const startAt = campaign.startAt?.toMillis?.() ?? new Date(campaign.startAt).getTime()
  const endAt = campaign.endAtExclusive?.toMillis?.() ?? new Date(campaign.endAtExclusive).getTime()
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return 'invalid'
  if (now >= endAt) return 'expired'
  if (campaign.enabled === false || (campaign.enabled === undefined && campaign.status === 'paused')) return 'paused'
  if (now < startAt) return 'scheduled'
  return 'active'
}

export function toJakartaDateInput(value) {
  if (!value) return ''
  const date = value.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
  return `${values.year}-${values.month}-${values.day}`
}

export function toJakartaInclusiveEndInput(value) {
  if (!value) return ''
  const endExclusive = value.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(endExclusive.getTime())) return ''
  return toJakartaDateInput(new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000))
}

export function formatCampaignPeriod(campaign) {
  const start = campaign.startAt?.toDate ? campaign.startAt.toDate() : new Date(campaign.startAt)
  const endExclusive = campaign.endAtExclusive?.toDate
    ? campaign.endAtExclusive.toDate()
    : new Date(campaign.endAtExclusive)

  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) return 'Tanggal tidak valid'
  const endInclusive = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000)
  const formatter = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  })
  return `${formatter.format(start)} – ${formatter.format(endInclusive)} WIB`
}
