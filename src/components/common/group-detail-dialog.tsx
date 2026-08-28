import { Info, Layers, MessageSquareQuote, Tag } from 'lucide-react'

import { GroupStatusBadge } from '@/components/common/group-status-badge'
import { SpeechShareBar } from '@/components/common/speech-share-bar'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { formatPercent, formatTime } from '@/lib/format'
import { resolveGroupStatus, type GroupStatus } from '@/lib/group-status'
import type { ActivityStep, Group, GroupInsight } from '@/types/domain'

interface GroupDetailDialogProps {
  group: Group | null
  insight: GroupInsight | undefined
  steps: ActivityStep[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 사후 리포트처럼 실시간 판정을 쓰지 않는 화면에서 최종 상태를 넘긴다. */
  status?: GroupStatus
}

export function GroupDetailDialog({
  group,
  insight,
  steps,
  open,
  onOpenChange,
  status: statusOverride,
}: GroupDetailDialogProps) {
  if (!group) return null

  const status = statusOverride ?? resolveGroupStatus(group, insight)
  const currentStep = steps.find((step) => step.id === group.currentStepId)
  const canShowAnalysis = status.state === 'balanced' || status.state === 'skewed'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2.5">
            <DialogTitle>{group.name}</DialogTitle>
            <GroupStatusBadge status={status} />
          </div>
          <DialogDescription className="text-left">{status.action}</DialogDescription>
        </DialogHeader>

        <Separator />

        <ScrollArea className="max-h-[60dvh]">
          <div className="space-y-6 px-6 py-5">
            <section className="space-y-3">
              <h3 className="text-sm font-medium">익명 화자별 발화량 비율</h3>
              {canShowAnalysis ? (
                <SpeechShareBar shares={insight?.speakerShares ?? []} showLegend />
              ) : (
                <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-5 text-sm leading-relaxed">
                  {status.state === 'lost'
                    ? '연결이 끊겨 지금은 발화 비율을 판단하지 않습니다. 이전 값을 현재 상태처럼 보여주지 않습니다.'
                    : '판단할 정보가 아직 충분하지 않아 발화 비율을 표시하지 않습니다.'}
                </p>
              )}
              <p className="text-muted-foreground text-xs leading-relaxed">
                화자 A·B·C는 대화 안에서 서로 다른 목소리를 구분한 임시 표시이며 특정 학생을 가리키지
                않습니다.
              </p>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <MessageSquareQuote className="text-muted-foreground size-4" />
                주제와 무관해 보이는 발화
              </h3>
              {canShowAnalysis && insight && insight.offTopicEvidence.length > 0 ? (
                <div className="space-y-2.5">
                  <p className="text-muted-foreground text-sm">
                    전체 발화 중 약{' '}
                    <span className="text-foreground font-medium">
                      {formatPercent(insight.offTopicRatio)}
                    </span>
                    가 활동 주제와 연결되지 않는 것으로 추정됩니다.
                  </p>
                  <ul className="space-y-2">
                    {insight.offTopicEvidence.map((evidence, index) => (
                      <li key={index} className="bg-muted/50 space-y-1.5 rounded-lg px-3.5 py-3">
                        <p className="text-sm">“{evidence.quote}”</p>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {evidence.reason}
                          {evidence.at ? ` · ${formatTime(evidence.at)}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  주제와 무관한 발화로 판단된 근거가 아직 없습니다.
                </p>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-sm font-medium">대화 요약</h3>
              <p className="text-sm leading-relaxed">
                {canShowAnalysis && insight?.summary
                  ? insight.summary
                  : '요약할 만큼의 대화가 아직 모이지 않았습니다.'}
              </p>
              {insight && insight.keywords.length > 0 && canShowAnalysis && (
                <div className="flex flex-wrap gap-1.5">
                  {insight.keywords.map((keyword) => (
                    <Badge key={keyword} variant="secondary" className="font-normal">
                      <Tag className="size-3" />
                      {keyword}
                    </Badge>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <Layers className="text-muted-foreground size-4" />
                현재 단계
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {steps.length === 0 && (
                  <p className="text-muted-foreground text-sm">등록된 단계가 없습니다.</p>
                )}
                {steps.map((step) => (
                  <Badge
                    key={step.id}
                    variant={step.id === currentStep?.id ? 'default' : 'outline'}
                    className="font-normal"
                  >
                    {step.label}
                  </Badge>
                ))}
              </div>
            </section>

            {group.members.length > 0 && (
              <>
                <Separator />
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">모둠원</h3>
                  <p className="text-muted-foreground text-sm">
                    {group.members.map((member) => member.name).join(', ')}
                  </p>
                </section>
              </>
            )}

            <div className="text-muted-foreground flex items-start gap-2 rounded-lg border px-3.5 py-3">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <p className="text-xs leading-relaxed">
                이 정보는 교사가 먼저 살펴볼 모둠을 찾도록 돕는 수업 지원 신호이며, 학생 개인의
                성취·태도를 평가하는 근거가 아닙니다. 자동 분석에는 오류가 있을 수 있습니다.
              </p>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
