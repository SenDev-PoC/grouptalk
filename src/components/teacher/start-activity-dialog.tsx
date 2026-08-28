import { PenLine, Users2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { data } from '@/data'
import { cn } from '@/lib/utils'
import type { Activity, RosterSet } from '@/types/domain'

interface StartActivityDialogProps {
  teacherId: string
  activity: Activity | null
  onOpenChange: (open: boolean) => void
  onStarted: (sessionId: string) => void
}

export function StartActivityDialog({
  teacherId,
  activity,
  onOpenChange,
  onStarted,
}: StartActivityDialogProps) {
  const [rosterSets, setRosterSets] = useState<RosterSet[]>([])
  const [useRoster, setUseRoster] = useState(false)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!activity) return
    setStarting(false)
    void data()
      .listRosterSets(teacherId)
      .then((sets) => {
        setRosterSets(sets)
        setUseRoster(sets.length > 0)
        setSelectedSetId(sets[0]?.id ?? null)
      })
      .catch(() => {
        setRosterSets([])
        setUseRoster(false)
        setSelectedSetId(null)
      })
  }, [activity, teacherId])

  async function start() {
    if (!activity || starting) return
    if (useRoster && !selectedSetId) return
    setStarting(true)

    const tab = window.open('about:blank', '_blank')

    try {
      const session = await data().startSession({
        teacherId,
        activityId: activity.id,
        useRoster: useRoster && Boolean(selectedSetId),
        rosterSetId: useRoster ? (selectedSetId ?? undefined) : undefined,
      })
      const url = `/teacher/activity/${session.id}`

      if (tab) {
        tab.location.href = url
      } else {
        window.location.href = url
      }

      onStarted(session.id)
      onOpenChange(false)
    } catch {
      tab?.close()
      setStarting(false)
    }
  }

  const selectedSet = rosterSets.find((set) => set.id === selectedSetId) ?? null
  const canStart = !useRoster || Boolean(selectedSetId)

  return (
    <Dialog open={activity !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>활동 시작하기</DialogTitle>
          <DialogDescription>
            {activity?.title}의 새 세션을 엽니다. 학생 입장 방식을 선택해 주세요.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <OptionCard
            selected={useRoster}
            disabled={rosterSets.length === 0}
            icon={Users2}
            title="기존 모둠 배정 사용"
            description={
              rosterSets.length === 0
                ? '모둠 편성 탭에 저장된 배정 세트가 없습니다.'
                : selectedSet
                  ? `${selectedSet.name} · 모둠 ${selectedSet.groups.length}개 · 학생 ${selectedSet.groups.reduce((sum, group) => sum + group.students.length, 0)}명`
                  : '아래에서 사용할 배정 세트를 고르세요.'
            }
            onSelect={() => {
              setUseRoster(true)
              if (!selectedSetId) setSelectedSetId(rosterSets[0]?.id ?? null)
            }}
          />

          {useRoster && rosterSets.length > 0 && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-muted-foreground text-xs font-semibold">배정 세트 선택</p>
              <div className="grid gap-2">
                {rosterSets.map((set) => {
                  const studentCount = set.groups.reduce(
                    (sum, group) => sum + group.students.length,
                    0,
                  )
                  const selected = set.id === selectedSetId
                  return (
                    <button
                      key={set.id}
                      type="button"
                      onClick={() => setSelectedSetId(set.id)}
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors',
                        selected
                          ? 'border-primary bg-accent/60'
                          : 'hover:bg-muted/50',
                      )}
                    >
                      <p className="text-sm font-semibold">{set.name}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        모둠 {set.groups.length}개 · 학생 {studentCount}명
                        {set.groups.length > 0
                          ? ` · ${set.groups.map((group) => group.name).join(', ')}`
                          : ''}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <OptionCard
            selected={!useRoster}
            icon={PenLine}
            title="학생이 직접 입력"
            description="입장 화면에서 모둠 이름과 모둠원 이름을 직접 입력합니다."
            onSelect={() => setUseRoster(false)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={start} disabled={starting || !canStart}>
            {starting ? '세션 여는 중…' : '대기실 열기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OptionCard({
  selected,
  disabled = false,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  selected: boolean
  disabled?: boolean
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3.5 text-left transition-colors',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
        selected ? 'border-primary bg-accent/60' : 'hover:bg-muted/50',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <Icon className={cn('mt-0.5 size-4.5 shrink-0', selected && 'text-primary')} />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      </div>
    </button>
  )
}
