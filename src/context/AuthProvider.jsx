import { useEffect, useMemo, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { auth, firebaseAdminUid, firebaseConfigured } from '../firebase'
import { AuthContext } from './authContext'

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(firebaseConfigured ? 'loading' : 'unconfigured')
  const [user, setUser] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!auth) return undefined

    return onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          setUser(null)
          setStatus('signed-out')
          return
        }

        if (!firebaseAdminUid || currentUser.uid !== firebaseAdminUid) {
          setUser(null)
          setNotice('Akun ini tidak terdaftar sebagai pengguna dashboard.')
          setStatus('signed-out')
          try {
            await signOut(auth)
          } catch {
            setNotice('Akun ini tidak terdaftar dan sesi Firebase tidak dapat ditutup. Keluar lalu gunakan akun yang dikonfigurasi.')
          }
          return
        }

        setUser(currentUser)
        setNotice('')
        setStatus('signed-in')
      },
      () => {
        setUser(null)
        setStatus('verification-error')
      },
    )
  }, [])

  const value = useMemo(
    () => ({
      status,
      user,
      notice,
      signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
      signOut: () => signOut(auth),
    }),
    [status, user, notice],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
