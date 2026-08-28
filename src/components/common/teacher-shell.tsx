import { LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { BrandMark } from '@/components/common/brand-mark'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'

interface TeacherShellProps {
  children: ReactNode
  actions?: ReactNode
  /** 모둠 편성 화면처럼 넓은 작업 공간이 필요한 페이지용. */
  wide?: boolean
}

export function TeacherShell({ children, actions, wide = false }: TeacherShellProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const contentWidth = wide
    ? 'mx-auto w-full max-w-[1600px] px-6'
    : 'mx-auto w-full max-w-6xl px-6'

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="bg-primary text-primary-foreground sticky top-0 z-30 w-full border-b border-white/10">
        <div className={`${contentWidth} flex h-[4.5rem] items-center justify-between gap-4`}>
          <BrandMark to="/teacher" inverted />
          <div className="flex items-center gap-2">
            {actions}
            {user ? (
              <Button
                variant="on-primary"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => void handleSignOut()}
              >
                <LogOut className="size-3.5" />
                로그아웃
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className={`${contentWidth} flex-1 py-8`}>{children}</main>
    </div>
  )
}
