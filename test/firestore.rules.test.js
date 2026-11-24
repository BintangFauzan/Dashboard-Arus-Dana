import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'

const projectId = 'demo-arus-dana'
let testEnvironment

test.before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
})

test.after(async () => {
  await testEnvironment?.cleanup()
})

test('rules isolate user access and protect notification recipient configuration', async () => {
  await testEnvironment.clearFirestore()
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'access/user-a'), { effectiveStatus: 'free_tier' })
    await setDoc(doc(db, 'access/user-b'), { effectiveStatus: 'unlimited' })
    await setDoc(doc(db, 'config/accessPolicy'), { defaultStatus: 'free_tier' })
    await setDoc(doc(db, 'config/inAppNotifications'), { target: 'selected_users' })
    await setDoc(doc(db, 'config/inAppNotificationTargets'), { uids: ['user-a'] })
  })

  const userDb = testEnvironment.authenticatedContext('user-a').firestore()
  await assertSucceeds(getDoc(doc(userDb, 'access/user-a')))
  await assertFails(getDoc(doc(userDb, 'access/user-b')))
  await assertSucceeds(getDoc(doc(userDb, 'config/accessPolicy')))
  await assertFails(getDoc(doc(userDb, 'config/inAppNotifications')))
  await assertFails(getDoc(doc(userDb, 'config/inAppNotificationTargets')))

  const adminDb = testEnvironment.authenticatedContext('T1NayESIKubClhwpFaotV8Z7udu2').firestore()
  await assertSucceeds(getDoc(doc(adminDb, 'config/inAppNotificationTargets')))
})

test('feedback allows constrained creates but denies client mutation', async () => {
  await testEnvironment.clearFirestore()
  const userDb = testEnvironment.authenticatedContext('user-a').firestore()
  const feedbackRef = await assertSucceeds(addDoc(collection(userDb, 'feedback'), {
    uid: 'user-a',
    message: 'A useful comment',
    status: 'new',
    createdAt: serverTimestamp(),
  }))

  await assertFails(addDoc(collection(userDb, 'feedback'), {
    uid: 'user-b',
    message: 'Spoofed UID',
    status: 'new',
    createdAt: serverTimestamp(),
  }))
  await assertFails(setDoc(feedbackRef, { status: 'reviewed' }, { merge: true }))
})
