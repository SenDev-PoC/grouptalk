import { PenLine, Users2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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
import type { Activity } from '@/types/domain'
import type { ClassRoom, FormedGroup } from '@/types/group-formation'

interface StartActivityDialogProps {
  teacherId: string
  activity: Activity | null
  onOpenChange: (open: boolean) => void
  onStarted: (sessionId: string) => void
}

interface AssignmentOption {
  key: string
  name: string
  classId?: string
  rosterSetId?: string
  groups: { name: string; studentCount: number }[]
}

function toAssignmentFromClass(classroom: ClassRoom): AssignmentOption | null {
  const groups = classroom.activeGroups
  if (!groups || groups.length === 0) return null
  return {
    key: `class:${classroom.id}`,
    name: classroom.name,
    classId: classroom.id,
    groups: groups.map((group: FormedGroup) => ({
      name: group.groupName,
      studentCount: group.members.length,
    })),
  }
}

export function StartActivityDialog({
  teacherId,
  activity,
  onOpenChange,
  onStarted,
}: StartActivityDialogProps) {
  const [assignments, setAssignments] = useState<AssignmentOption[]>([])
  const [useRoster, setUseRoster] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    if (!activity) return
    setStarting(false)
    setStartError(null)
    void Promise.all([
      data().listClasses(teacherId),
      data()
        .listRosterSets(teacherId)
        .catch(() => []),
    ])
      .then(([classes, rosterSets]) => {
        const fromClasses = classes
          .map(toAssignmentFromClass)
          .filter((item): item is AssignmentOption => Boolean(item))

        const classNames = new Set(fromClasses.map((item) => item.name))
        const fromRosters = rosterSets
          .filter((set) => !classNames.has(set.name))
          .map((set) => ({
            key: `roster:${set.id}`,
            name: set.name,
            rosterSetId: set.id,
            groups: set.groups.map((group) => ({
              name: group.name,
              studentCount: group.students.length,
            })),
          }))

        const next = [...fromClasses, ...fromRosters]
        setAssignments(next)
        setUseRoster(next.length > 0)
        setSelectedKey(next[0]?.key ?? null)
      })
      .catch(() => {
        setAssignments([])
        setUseRoster(false)
        setSelectedKey(null)
      })
  }, [activity, teacherId])

  const selected = useMemo(
    () => assignments.find((item) => item.key === selectedKey) ?? null,
    [assignments, selectedKey],
  )

  async function start() {
    if (!activity || starting) return
    if (useRoster && !selected) return
    setStarting(true)
    setStartError(null)

    const tab = window.open('about:blank', '_blank')

    try {
      const session = await data().startSession({
        teacherId,
        activityId: activity.id,
        useRoster: useRoster && Boolean(selected),
        classId: useRoster ? selected?.classId : undefined,
        rosterSetId: useRoster ? selected?.rosterSetId : undefined,
      })
      const url = `/teacher/activity/${session.id}`

      if (tab) {
        tab.location.href = url
      } else {
        window.location.href = url
      }

      onStarted(session.id)
      onOpenChange(false)
    } catch (error) {
      tab?.close()
      setStarting(false)
      setStartError(error instanceof Error ? error.message : '활동을 시작하지 못했습니다.')
    }
  }

  const canStart = !useRoster || Boolean(selected)
  const studentCount =
    selected?.groups.reduce((sum, group) => sum + group.studentCount, 0) ?? 0

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
            disabled={assignments.length === 0}
            icon={Users2}
            title="기존 모둠 배정 사용"
            description={
              assignments.length === 0
                ? '모둠 편성 탭에서 「이 조로 확정」한 학급이 없습니다.'
                : selected
                  ? `${selected.name} · 모둠 ${selected.groups.length}개 · 학생 ${studentCount}명`
                  : '아래에서 사용할 배정을 고르세요.'
            }
            onSelect={() => {
              setUseRoster(true)
              if (!selectedKey) setSelectedKey(assignments[0]?.key ?? null)
            }}
          />

          {useRoster && assignments.length > 0 && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-muted-foreground text-xs font-semibold">배정 선택</p>
              <div className="grid gap-2">
                {assignments.map((item) => {
                  const count = item.groups.reduce((sum, group) => sum + group.studentCount, 0)
                  const isSelected = item.key === selectedKey
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSelectedKey(item.key)}
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors',
                        isSelected ? 'border-primary bg-accent/60' : 'hover:bg-muted/50',
                      )}
                    >
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        모둠 {item.groups.length}개 · 학생 {count}명
                        {item.groups.length > 0
                          ? ` · ${item.groups.map((group) => group.name).join(', ')}`
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

        {startError ? (
          <p className="text-destructive text-sm" role="alert">
            {startError}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={start} disabled={starting || !canStart}>
            {starting ? '시작 중…' : '시작하기'}
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
