import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { AuthScreen } from '@/components/auth/auth-screen'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isDemoMode } from '@/data'
import { useAuth } from '@/hooks/use-auth'
import { MIN_PASSWORD_LENGTH, mapAuthError } from '@/lib/auth'

function teacherPathFrom(state: unknown) {
  if (
    state &&
    typeof state === 'object' &&
    'from' in state &&
    typeof state.from === 'string'
  ) {
    const from = state.from
    if (
      (from === '/teacher' || from.startsWith('/teacher/')) &&
      !from.includes('//') &&
      !from.includes('\\')
    ) {
      return from
    }
  }
  return '/teacher'
}

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = teacherPathFrom(location.state)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
      navigate(from, { replace: true })
    } catch (caught) {
      setError(mapAuthError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthScreen>
      <Card className="w-full gap-0 py-0">
        <CardHeader className="gap-1 px-4 pt-4 pb-0">
          <p className="text-muted-foreground text-xs">교사 계정으로 입장합니다</p>
          <h1 className="text-lg leading-tight font-bold tracking-tight">교사 로그인</h1>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4 px-4 pt-4 pb-4">
            {isDemoMode ? (
              <p className="bg-sand-soft text-sand-foreground rounded-lg px-3.5 py-3 text-sm leading-relaxed">
                데모 모드입니다. 계정은 이 브라우저에만 저장됩니다.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </CardContent>

          <CardFooter className="flex w-full flex-col gap-3 border-t px-4 pt-3 pb-4">
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
              {submitting ? '로그인하는 중…' : '로그인'}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              아직 계정이 없나요?{' '}
              <Link to="/signup" className="text-foreground font-semibold hover:underline">
                회원가입
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthScreen>
  )
}
