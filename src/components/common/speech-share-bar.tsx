import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SpeakerShare } from '@/types/domain'

const SEGMENT_COLORS = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
]

/**
 * 익명 화자별 발화 비율. 화자 표시는 학생 이름이 아니므로 이름을 함께 쓰지 않는다.
 */
export function SpeechShareBar({
  shares,
  className,
  showLegend = false,
}: {
  shares: SpeakerShare[]
  className?: string
  showLegend?: boolean
}) {
  const total = shares.reduce((sum, share) => sum + share.ratio, 0)

  if (shares.length === 0 || total <= 0) {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full" />
        <p className="text-muted-foreground min-h-5 text-xs leading-5">
          아직 발화 비율을 계산할 정보가 없습니다.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full">
        {shares.map((share, index) => (
          <div
            key={share.speakerLabel}
            className={cn('h-full', SEGMENT_COLORS[index % SEGMENT_COLORS.length])}
            style={{ width: `${(share.ratio / total) * 100}%` }}
            title={`${share.speakerLabel} ${formatPercent(share.ratio)}`}
          />
        ))}
      </div>

      {showLegend ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {shares.map((share, index) => (
            <li key={share.speakerLabel} className="flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  'size-2 rounded-full',
                  SEGMENT_COLORS[index % SEGMENT_COLORS.length],
                )}
              />
              <span className="text-muted-foreground">{share.speakerLabel}</span>
              <span className="tabular font-medium">{formatPercent(share.ratio)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground min-h-5 text-xs leading-5">
          익명 화자 {shares.length}명의 발화 비율
        </p>
      )}
    </div>
  )
}
