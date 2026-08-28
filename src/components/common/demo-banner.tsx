import { FlaskConical } from 'lucide-react'

import { isDemoMode } from '@/data'
import { cn } from '@/lib/utils'

/**
 * 무엇이 실제 연결이고 무엇이 합성 상태인지 시연 중에 감추지 않는다.
 * (07-implementation-plan 데모 생명줄)
 */
export function DemoBanner({ compact = false }: { compact?: boolean }) {
  if (!isDemoMode) return null

  return (
    <div
      className={cn(
        'border-warning/25 bg-background text-foreground mb-6 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5',
        compact && 'mb-4',
      )}
    >
      <FlaskConical className="text-warning mt-0.5 size-4 shrink-0" />
      <p className="text-sm leading-relaxed">
        <span className="font-medium">데모 데이터로 동작 중입니다.</span> Supabase 연결 정보가 없어
        참여 분석은 합성 상태이며 실제 음성 분석 결과가 아닙니다.
      </p>
    </div>
  )
}
