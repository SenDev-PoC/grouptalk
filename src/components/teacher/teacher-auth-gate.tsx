import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSupabase } from '@/data/supabase'
import { isDemoMode } from '@/data'
import { getTeacherId } from '@/lib/teacher'
import { TeacherIdContext } from '@/lib/teacher-auth-context'

type GateState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'authenticated'; teacherId: string }

export function TeacherAuthGate() {
  const [state, setState] = useState<GateState>(() =>
    isDemoMode
      ? { kind: 'authenticated', teacherId: getTeacherId() }
      : { kind: 'loading' },
  )
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (isDemoMode) return

    const db = getSupabase()
    let active = true

    function applySession(session: Awaited<ReturnType<typeof db.auth.getSession>>['data']['session']) {
      if (!active) return
      if (session && !session.user.is_anonymous) {
        setState({ kind: 'authenticated', teacherId: session.user.id })
      } else {
        setState({ kind: 'signed-out' })
      }
    }

    void db.auth.getSession().then(({ data }) => applySession(data.session))
    const { data: subscription } = db.auth.onAuthStateChange((_event, session) => {
      applySession(session)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function sendMagicLink() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return

    setSending(true)
    setSent(false)
    setErrorMessage(null)
    try {
      const db = getSupabase()
      const current = await db.auth.getSession()
      if (current.error) throw current.error
      if (current.data.session?.user.is_anonymous) {
        const signOut = await db.auth.signOut()
        if (signOut.error) throw signOut.error
      }

      const result = await db.auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: `${window.location.origin}/teacher` },
      })
      if (result.error) throw result.error
      setSent(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '로그인 링크를 보내지 못했습니다.')
    } finally {
      setSending(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="bg-primary/70 size-2.5 animate-soft-pulse rounded-full" />
        <span className="sr-only">교사 인증 확인 중</span>
      </div>
    )
  }

  if (state.kind === 'signed-out') {
    return (
      <main className="bg-background flex min-h-dvh items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>교사 로그인</CardTitle>
            <p className="text-muted-foreground text-sm">
              활동과 보고서를 보호하기 위해 교사 이메일로 로그인해 주세요.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="teacher-email">이메일</Label>
              <Input
                id="teacher-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void sendMagicLink()
                }}
                placeholder="teacher@example.com"
              />
            </div>
            <Button className="w-full" disabled={sending || !email.trim()} onClick={sendMagicLink}>
              {sending ? '전송 중…' : '로그인 링크 받기'}
            </Button>
            {sent ? (
              <p className="text-sm text-emerald-700">이메일에서 로그인 링크를 확인해 주세요.</p>
            ) : null}
            {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <TeacherIdContext.Provider value={state.teacherId}>
      <Outlet />
    </TeacherIdContext.Provider>
  )
}
