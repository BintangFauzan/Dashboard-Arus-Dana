import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const missingFirebaseConfig = [
  ...Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key),
]

export const firebaseConfigured = missingFirebaseConfig.length === 0
export const firebaseAdminUid = import.meta.env.VITE_FIREBASE_ADMIN_UID?.trim() || ''
export const firebaseApp = firebaseConfigured ? initializeApp(config) : null
export const auth = firebaseApp ? getAuth(firebaseApp) : null
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null

export const CLOUD_FUNCTIONS_BASE_URL = firebaseConfigured
  ? `https://us-central1-arus-dana-mvp.cloudfunctions.net`
  : ''

export async function callCloudFunction({ functionName, body, requiresIdToken }) {
  if (!firebaseApp || !auth) throw new Error('Firebase belum dikonfigurasi.')
  const user = auth.currentUser
  if (!user) throw new Error('Silakan login terlebih dahulu.')

  const headers = { 'Content-Type': 'application/json' }
  if (requiresIdToken) {
    const token = await user.getIdToken()
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${CLOUD_FUNCTIONS_BASE_URL}/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.error || `Permintaan ke ${functionName} gagal.`)
    error.status = response.status
    throw error
  }
  return data
}

if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && firestore && auth) {
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}

export function getFunctionsBaseUrl() {
  return CLOUD_FUNCTIONS_BASE_URL
}
