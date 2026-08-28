import { Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { DemoBanner } from '@/components/common/demo-banner'
import { cn } from '@/lib/utils'

interface TeacherShellProps {
  children: ReactNode
  actions?: ReactNode
  /** 실시간 대시보드처럼 화면을 넓게 쓰는 페이지용. */
  wide?: boolean
}

export function TeacherShell({ children, actions, wide = false }: TeacherShellProps) {
  return (
    <div className="bg-background min-h-dvh">
      <header className="bg-primary text-primary-foreground sticky top-0 z-30 border-b border-white/10">
        <div
          className={cn(
            'mx-auto flex h-[4.5rem] items-center justify-between gap-4 px-6',
            wide ? 'max-w-[1600px]' : 'max-w-6xl',
          )}
        >
          <Link to="/teacher" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
              <Users className="size-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">모둠뷰</span>
          </Link>
          {actions}
        </div>
      </header>

      <main className={cn('mx-auto px-6 py-8', wide ? 'max-w-[1600px]' : 'max-w-6xl')}>
        <DemoBanner />
        {children}
      </main>
    </div>
  )
}
