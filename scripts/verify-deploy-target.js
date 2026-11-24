import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const expectedProjectId = process.env.FIREBASE_TARGET_PROJECT_ID
const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let firebaseConfig = {}

if (process.env.FIREBASE_CONFIG) {
  try {
    firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG)
  } catch {
    throw new Error('Firebase CLI provided invalid FIREBASE_CONFIG JSON.')
  }
}

const activeProjectId = process.env.GCLOUD_PROJECT || firebaseConfig.projectId

if (!expectedProjectId) {
  throw new Error('Set FIREBASE_TARGET_PROJECT_ID to the confirmed Firebase project ID before deploying.')
}

if (!activeProjectId) {
  throw new Error('Firebase CLI did not expose the active project ID; refusing to deploy.')
}

if (expectedProjectId !== activeProjectId) {
  throw new Error(`Deployment target mismatch: expected ${expectedProjectId}, Firebase CLI selected ${activeProjectId}.`)
}

if (expectedProjectId.startsWith('demo-')) {
  throw new Error('Demo Firebase projects cannot be deployment targets.')
}

function readEnvValue(filePath, name) {
  if (!existsSync(filePath)) return ''
  const line = readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') || ''
}

const webAdminUid = readEnvValue(path.join(rootDirectory, '.env.local'), 'VITE_FIREBASE_ADMIN_UID')
const functionsAdminUid = readEnvValue(path.join(rootDirectory, 'functions', '.env'), 'ADMIN_UID')
const rulesSource = readFileSync(path.join(rootDirectory, 'firestore.rules'), 'utf8')
const rulesAdminUid = rulesSource.match(/request\.auth\.uid\s*==\s*'([^']+)'/)?.[1] || ''
if (!webAdminUid || !functionsAdminUid || !rulesAdminUid
  || webAdminUid !== functionsAdminUid || webAdminUid !== rulesAdminUid) {
  throw new Error('VITE_FIREBASE_ADMIN_UID, functions/.env ADMIN_UID, and the Firestore Rules admin UID must match before deploying.')
}

console.log(`Confirmed Firebase deployment target: ${activeProjectId}`)
