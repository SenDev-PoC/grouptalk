import { Plus, Save, Trash2, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { data } from '@/data'

interface DraftGroup {
  name: string
  /** 쉼표 또는 줄바꿈으로 구분한 학생 이름. 입력 중에는 원문을 그대로 둔다. */
  studentsText: string
}

function parseStudents(text: string) {
  return text
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)
}

export function RosterManager({ teacherId }: { teacherId: string }) {
  const [groups, setGroups] = useState<DraftGroup[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void data()
      .listRoster(teacherId)
      .then((roster) =>
        setGroups(
          roster.map((group) => ({
            name: group.name,
            studentsText: group.students.map((student) => student.name).join(', '),
          })),
        ),
      )
      .catch(() => setGroups([]))
  }, [teacherId])

  function update(index: number, patch: Partial<DraftGroup>) {
    setGroups((prev) =>
      prev ? prev.map((group, i) => (i === index ? { ...group, ...patch } : group)) : prev,
    )
  }

  async function save() {
    if (!groups) return
    const prepared = groups
      .map((group) => ({ name: group.name.trim(), students: parseStudents(group.studentsText) }))
      .filter((group) => group.name.length > 0)

    setSaving(true)
    try {
      await data().saveRoster(teacherId, prepared)
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  if (groups === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          미리 저장해 둔 모둠 배정은 활동을 시작할 때 그대로 불러올 수 있습니다. 학생이 입장 화면에서
          이름을 다시 입력하지 않아도 됩니다.
        </p>
        <Button onClick={save} disabled={saving} className="shrink-0">
          <Save className="size-4" />
          {saving ? '저장 중…' : '배정 저장'}
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="저장된 모둠 배정이 없습니다"
          description="모둠을 추가하고 모둠원 이름을 쉼표로 구분해 입력하면, 활동을 시작할 때 자동으로 배정할 수 있습니다."
          action={
            <Button
              variant="outline"
              onClick={() => setGroups([{ name: '1모둠', studentsText: '' }])}
            >
              <Plus className="size-4" />
              모둠 추가
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {groups.map((group, index) => (
            <Card key={index} className="py-4">
              <CardContent className="grid grid-cols-[minmax(0,220px)_1fr_auto] items-end gap-3 px-4">
                <div className="space-y-1.5">
                  <Label htmlFor={`roster-name-${index}`} className="text-xs">
                    모둠 이름
                  </Label>
                  <Input
                    id={`roster-name-${index}`}
                    value={group.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                    placeholder="예: 햇살"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`roster-students-${index}`} className="text-xs">
                    모둠원 ({parseStudents(group.studentsText).length}명)
                  </Label>
                  <Input
                    id={`roster-students-${index}`}
                    value={group.studentsText}
                    onChange={(event) => update(index, { studentsText: event.target.value })}
                    placeholder="이름을 쉼표로 구분해 입력"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setGroups(groups.filter((_, i) => i !== index))}
                  aria-label={`${group.name || index + 1} 모둠 삭제`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}

          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              setGroups([...groups, { name: `${groups.length + 1}모둠`, studentsText: '' }])
            }
          >
            <Plus className="size-4" />
            모둠 추가
          </Button>
        </div>
      )}
    </div>
  )
}
