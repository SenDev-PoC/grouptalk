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
import type { Activity, RosterGroup } from '@/types/domain'

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
  const [roster, setRoster] = useState<RosterGroup[]>([])
  const [useRoster, setUseRoster] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!activity) return
    setStarting(false)
    void data()
      .listRoster(teacherId)
      .then((groups) => {
        setRoster(groups)
        setUseRoster(groups.length > 0)
      })
      .catch(() => setRoster([]))
  }, [activity, teacherId])

  async function start() {
    if (!activity || starting) return
    setStarting(true)

    // 클릭 핸들러 안에서 동기적으로 탭을 연 뒤, 세션 생성 후 URL만 넣는다.
    const tab = window.open('about:blank', '_blank')

    try {
      const session = await data().startSession({
        teacherId,
        activityId: activity.id,
        useRoster: useRoster && roster.length > 0,
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

  const totalStudents = roster.reduce((sum, group) => sum + group.students.length, 0)

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
            disabled={roster.length === 0}
            icon={Users2}
            title="기존 모둠 배정 사용"
            description={
              roster.length === 0
                ? '모둠 편성 탭에 저장된 모둠 배정이 없습니다.'
                : `모둠 ${roster.length}개 · 학생 ${totalStudents}명이 자동으로 배정됩니다.`
            }
            onSelect={() => setUseRoster(true)}
          />
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
          <Button onClick={start} disabled={starting}>
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
