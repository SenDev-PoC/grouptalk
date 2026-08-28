import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { AuthContext, type AuthContextValue } from '@/components/auth/auth-context'
import {
  signIn as signInRequest,
  signOut as signOutRequest,
  signUp as signUpRequest,
  subscribeAuth,
  type AuthUser,
} from '@/lib/auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const unsubscribe = subscribeAuth((next) => {
      if (!active) return
      setUser(next)
      setLoading(false)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async signIn(email, password) {
        const next = await signInRequest(email, password)
        setUser(next)
        return next
      },
      async signUp(input) {
        const result = await signUpRequest(input)
        if (result.kind === 'session') setUser(result.user)
        return result
      },
      async signOut() {
        await signOutRequest()
        setUser(null)
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
