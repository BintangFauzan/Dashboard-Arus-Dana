import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

const projectId = process.env.FIREBASE_TARGET_PROJECT_ID
const deployTargets = process.argv[2] || 'hosting,functions,firestore'
const allowedTargets = new Set(['hosting', 'functions', 'firestore'])
const requestedTargets = deployTargets.split(',')

if (!projectId) {
  throw new Error('Set FIREBASE_TARGET_PROJECT_ID to the confirmed Firebase project ID before deploying.')
}

if (projectId.startsWith('demo-') || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  throw new Error('FIREBASE_TARGET_PROJECT_ID must be a valid, non-demo Firebase project ID.')
}

if (requestedTargets.some((target) => !allowedTargets.has(target))) {
  throw new Error(`Unsupported deployment target: ${deployTargets}`)
}

const firebaseCli = path.resolve(currentDirectory, '../node_modules/firebase-tools/lib/bin/firebase.js')
const result = spawnSync(process.execPath, [
  firebaseCli,
  'deploy',
  '--project',
  projectId,
  '--only',
  requestedTargets.join(','),
], { stdio: 'inherit' })

if (result.error) throw result.error
process.exit(result.status ?? 1)
