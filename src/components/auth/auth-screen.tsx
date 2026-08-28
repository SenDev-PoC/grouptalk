import type { ReactNode } from 'react'

import { BrandMark } from '@/components/common/brand-mark'

/** 학생 입장 화면과 같이, 카드를 화면 가운데에 둔다. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-dvh items-center justify-center overflow-y-auto px-4 py-8">
      <div className="flex w-full max-w-md flex-col items-center gap-5">
        <BrandMark />
        {children}
      </div>
    </div>
  )
}
