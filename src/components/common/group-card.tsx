import { Hand, Layers } from 'lucide-react'

import { GroupStatusBadge } from '@/components/common/group-status-badge'
import { SpeechShareBar } from '@/components/common/speech-share-bar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { GroupStatus } from '@/lib/group-status'
import { cn } from '@/lib/utils'
import type { ActivityStep, Group, GroupInsight } from '@/types/domain'

interface GroupCardProps {
  group: Group
  insight: GroupInsight | undefined
  status: GroupStatus
  steps: ActivityStep[]
  /** 도움 요청 순번. 1부터 시작하며 없으면 null. */
  helpOrder: number | null
  onClick: () => void
}

export function GroupCard({
  group,
  insight,
  status,
  steps,
  helpOrder,
  onClick,
}: GroupCardProps) {
  const currentStep = steps.find((step) => step.id === group.currentStepId)
  const showShares = status.state === 'balanced' || status.state === 'skewed'

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'hover:border-primary/40 focus-visible:ring-ring/50 cursor-pointer gap-4 py-5 transition-colors outline-none focus-visible:ring-[3px]',
        helpOrder !== null && 'border-warning/60 bg-warning-soft',
      )}
    >
      <CardContent className="space-y-4 px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate font-semibold">{group.name}</p>
            <p className="text-muted-foreground text-xs">
              {group.members.length > 0 ? `모둠원 ${group.members.length}명` : '모둠원 미등록'}
            </p>
          </div>
          <GroupStatusBadge status={status} />
        </div>

        <SpeechShareBar shares={showShares ? (insight?.speakerShares ?? []) : []} />

        <div className="flex flex-wrap items-center gap-1.5">
          {helpOrder !== null && (
            <Badge className="bg-warning text-warning-foreground">
              <Hand className="size-3" />
              도움 요청 {helpOrder}번째
            </Badge>
          )}
          <Badge variant="secondary" className="font-normal">
            <Layers className="size-3" />
            {currentStep ? currentStep.label : '단계 미선택'}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}
