import { Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface TeacherShellProps {
  children: ReactNode
  actions?: ReactNode
  /** 모둠 편성 화면처럼 넓은 작업 공간이 필요한 페이지용. */
  wide?: boolean
}

export function TeacherShell({ children, actions, wide = false }: TeacherShellProps) {
  const contentWidth = wide
    ? 'mx-auto w-full max-w-[1600px] px-6'
    : 'mx-auto w-full max-w-6xl px-6'

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="bg-primary text-primary-foreground sticky top-0 z-30 w-full border-b border-white/10">
        <div className={`${contentWidth} flex h-[4.5rem] items-center justify-between gap-4`}>
          <Link to="/teacher" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
              <Users className="size-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">모둠뷰</span>
          </Link>
          {actions}
        </div>
      </header>

      <main className={`${contentWidth} flex-1 py-8`}>{children}</main>
    </div>
  )
}
