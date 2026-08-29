import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** 학생 화면 공통 껍데기. 모바일 한 손 조작을 기준으로 한다. */
export function MobileShell({
  children,
  className,
  centered = false,
}: {
  children: ReactNode
  className?: string
  /** 짧은 화면은 세로 중앙, 길면 페이지 전체가 스크롤된다 */
  centered?: boolean
}) {
  useEffect(() => {
    document.body.dataset.viewport = 'mobile'
    return () => {
      delete document.body.dataset.viewport
    }
  }, [])

  return (
    <div className="bg-background min-h-dvh">
      <div
        className={cn(
          'mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        <div className={cn('w-full', centered && 'my-auto')}>{children}</div>
      </div>
    </div>
  )
}
