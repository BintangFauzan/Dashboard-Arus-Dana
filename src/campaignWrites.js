import { collection, getDocs, serverTimestamp, addDoc } from 'firebase/firestore'
import { firestore, auth } from './firebase'
import { buildCampaignInput, findCampaignConflicts } from './campaignInput'

export async function createCampaignDirect(data) {
  if (!firestore) throw new Error('Firestore belum dikonfigurasi.')

  const input = buildCampaignInput(data)

  const existingSnapshot = await getDocs(collection(firestore, 'accessCampaigns'))
  const conflicts = findCampaignConflicts(
    input,
    existingSnapshot.docs.map((document) => ({
      id: document.id,
      ...document.data(),
    })),
  )
  if (conflicts.length > 0) {
    const error = new Error(
      `Jadwal bertabrakan dengan kampanye: ${conflicts.map((item) => item.id).join(', ')}.`,
    )
    error.code = 'failed-precondition'
    throw error
  }

  const campaignDoc = {
    ...input,
    timezone: 'Asia/Jakarta',
    enabled: true,
    status: input.startAt.getTime() > Date.now() ? 'scheduled' : 'active',
    accessReconciledAt: null,
    createdAt: serverTimestamp(),
    createdBy: auth?.currentUser?.uid || '',
  }

  const campaignRef = await addDoc(collection(firestore, 'accessCampaigns'), campaignDoc)
  await addDoc(collection(firestore, 'adminActivity'), {
    adminUid: auth?.currentUser?.uid || '',
    type: 'create_access_campaign',
    summary: "Kampanye akses '" + input.name + "' dibuat",
    metadata: {
      campaignId: campaignRef.id,
      target: input.target,
      uids: input.uids,
      startAt: input.startAt.toISOString(),
      endAtExclusive: input.endAtExclusive.toISOString(),
      postExpiryStatus: input.postExpiryStatus,
    },
    createdAt: serverTimestamp(),
  })
  return { ok: true, campaignId: campaignRef.id }
}