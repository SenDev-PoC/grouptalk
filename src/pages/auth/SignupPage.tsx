import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AuthScreen } from '@/components/auth/auth-screen'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isDemoMode } from '@/data'
import { useAuth } from '@/hooks/use-auth'
import { MIN_PASSWORD_LENGTH, mapAuthError } from '@/lib/auth'

export default function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('비밀번호가 서로 다릅니다.')
      return
    }
    setSubmitting(true)
    try {
      const result = await signUp({
        email,
        password,
        displayName,
      })
      if (result.kind === 'confirm-email') {
        setPendingEmail(result.email)
        return
      }
      navigate('/teacher', { replace: true })
    } catch (caught) {
      setError(mapAuthError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  if (pendingEmail) {
    return (
      <AuthScreen>
        <Card className="w-full gap-0 py-0">
          <CardHeader className="gap-1 px-4 pt-4 pb-0">
            <p className="text-muted-foreground text-xs">교사 계정을 만듭니다</p>
            <h1 className="text-lg leading-tight font-bold tracking-tight">
              이메일을 확인해 주세요
            </h1>
          </CardHeader>
          <CardContent className="px-4 pt-4 pb-4">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {pendingEmail}로 인증 메일을 보냈습니다. 링크를 열면 로그인한 뒤 수업을 시작할 수
              있습니다.
            </p>
          </CardContent>
          <CardFooter className="flex w-full flex-col border-t px-4 pt-3 pb-4">
            <Button asChild size="lg" className="w-full">
              <Link to="/login">교사 로그인</Link>
            </Button>
          </CardFooter>
        </Card>
      </AuthScreen>
    )
  }

  return (
    <AuthScreen>
      <Card className="w-full gap-0 py-0">
        <CardHeader className="gap-1 px-4 pt-4 pb-0">
          <p className="text-muted-foreground text-xs">교사 계정을 만듭니다</p>
          <h1 className="text-lg leading-tight font-bold tracking-tight">회원가입</h1>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4 px-4 pt-4 pb-4">
            {isDemoMode ? (
              <p className="bg-sand-soft text-sand-foreground rounded-lg px-3.5 py-3 text-sm leading-relaxed">
                데모 모드입니다. 계정은 이 브라우저에만 저장되며, 첫 계정은 기존 연습 데이터를
                이어받습니다.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="displayName">이름</Label>
              <Input
                id="displayName"
                name="name"
                autoComplete="name"
                required
                maxLength={40}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>

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
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {MIN_PASSWORD_LENGTH}자 이상 입력해 주세요.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">비밀번호 확인</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
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
              {submitting ? '가입하는 중…' : '계정 만들기'}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              이미 계정이 있나요?{' '}
              <Link to="/login" className="text-foreground font-semibold hover:underline">
                교사 로그인
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthScreen>
  )
}
