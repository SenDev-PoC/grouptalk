import { AlertTriangle, MessageSquareWarning } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { GroupInsight } from '@/types/domain'
import type { GroupDisplayState } from '@/lib/group-status'

/** 교사 화면에서 경고로 보이는 참여·주제 신호를 학생에게도 안내한다. */
export function StudentParticipationAlerts({
  statusState,
  insight,
  className,
}: {
  statusState: GroupDisplayState
  insight: GroupInsight | undefined
  className?: string
}) {
  const showSkewed = statusState === 'skewed'
  const showOffTopic =
    (statusState === 'balanced' || statusState === 'skewed') &&
    Boolean(insight && insight.offTopicEvidence.length > 0)

  if (!showSkewed && !showOffTopic) return null

  return (
    <div className={cn('space-y-1.5', className)}>
      {showSkewed && (
        <AlertBanner
          icon={AlertTriangle}
          tone="danger"
          title="발화가 한쪽에 몰리고 있어요"
          body="한 친구가 많이 말하고 있어요. 다른 모둠원도 의견을 나눠 보세요."
        />
      )}
      {showOffTopic && (
        <AlertBanner
          icon={MessageSquareWarning}
          tone="warning"
          title="주제와 다른 이야기 같아요"
          body="활동 주제와 무관해 보이는 대화가 감지됐어요. 다시 주제로 돌아와 볼까요?"
        />
      )}
    </div>
  )
}

function AlertBanner({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof AlertTriangle
  tone: 'danger' | 'warning'
  title: string
  body: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5',
        tone === 'danger' && 'border-danger/35 bg-danger-soft text-danger',
        tone === 'warning' && 'border-warning/40 bg-warning-soft text-warning',
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-bold">{title}</p>
        <p className="text-[0.7rem] leading-relaxed opacity-90">{body}</p>
      </div>
    </div>
  )
}
