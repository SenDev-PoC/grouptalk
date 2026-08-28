import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** 학생 화면 공통 껍데기. 모바일 한 손 조작을 기준으로 한다. */
export function MobileShell({ children, className }: { children: ReactNode; className?: string }) {
  useEffect(() => {
    document.body.dataset.viewport = 'mobile'
    return () => {
      delete document.body.dataset.viewport
    }
  }, [])

  return (
    <div className="bg-background flex min-h-dvh justify-center">
      <div
        className={cn(
          'flex w-full max-w-md flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
