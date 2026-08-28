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
  /** 카드형 화면을 세로 중앙에 배치 */
  centered?: boolean
}) {
  useEffect(() => {
    document.body.dataset.viewport = 'mobile'
    return () => {
      delete document.body.dataset.viewport
    }
  }, [])

  return (
    <div className="bg-background flex h-dvh justify-center overflow-hidden">
      <div
        className={cn(
          'flex h-full w-full max-w-md flex-col overflow-y-auto px-4 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          centered && 'justify-center',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
