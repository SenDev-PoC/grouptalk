import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { data } from '@/data'
import { cn } from '@/lib/utils'

interface DraftGroup {
  name: string
  studentsText: string
}

interface DraftSet {
  name: string
  groups: DraftGroup[]
}

function parseStudents(text: string) {
  return text
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)
}

function emptySet(label: string): DraftSet {
  return {
    name: label,
    groups: [{ name: '1모둠', studentsText: '' }],
  }
}

export function RosterManager({ teacherId }: { teacherId: string }) {
  const [sets, setSets] = useState<DraftSet[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void data()
      .listRosterSets(teacherId)
      .then((rosterSets) => {
        if (rosterSets.length === 0) {
          setSets([])
          setActiveIndex(0)
          return
        }
        setSets(
          rosterSets.map((set) => ({
            name: set.name,
            groups: set.groups.map((group) => ({
              name: group.name,
              studentsText: group.students.map((student) => student.name).join(', '),
            })),
          })),
        )
        setActiveIndex(0)
      })
      .catch(() => {
        setSets([])
        setActiveIndex(0)
      })
  }, [teacherId])

  function updateSet(index: number, patch: Partial<DraftSet>) {
    setSets((prev) =>
      prev ? prev.map((set, i) => (i === index ? { ...set, ...patch } : set)) : prev,
    )
  }

  function updateGroup(setIndex: number, groupIndex: number, patch: Partial<DraftGroup>) {
    setSets((prev) =>
      prev
        ? prev.map((set, i) =>
            i === setIndex
              ? {
                  ...set,
                  groups: set.groups.map((group, j) =>
                    j === groupIndex ? { ...group, ...patch } : group,
                  ),
                }
              : set,
          )
        : prev,
    )
  }

  async function save() {
    if (!sets) return
    const prepared = sets
      .map((set) => ({
        name: set.name.trim() || '이름 없는 편성',
        groups: set.groups
          .map((group) => ({
            name: group.name.trim(),
            students: parseStudents(group.studentsText),
          }))
          .filter((group) => group.name.length > 0),
      }))
      .filter((set) => set.groups.length > 0 || set.name.length > 0)

    setSaving(true)
    try {
      const saved = await data().saveRosterSets(teacherId, prepared)
      setSets(
        saved.map((set) => ({
          name: set.name,
          groups: set.groups.map((group) => ({
            name: group.name,
            studentsText: group.students.map((student) => student.name).join(', '),
          })),
        })),
      )
      setActiveIndex((prev) => Math.min(prev, Math.max(saved.length - 1, 0)))
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  if (sets === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const active = sets[activeIndex] ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {sets.map((set, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
                index === activeIndex
                  ? 'border-primary bg-accent text-foreground'
                  : 'hover:bg-muted/60 text-muted-foreground',
              )}
            >
              {set.name.trim() || `편성 ${index + 1}`}
            </button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSets([...sets, emptySet(`${sets.length + 1}반 편성`)])
              setActiveIndex(sets.length)
            }}
          >
            <Plus className="size-4" />
            세트 추가
          </Button>
        </div>

        <Button onClick={save} disabled={saving} className="shrink-0">
          <Save className="size-4" />
          {saving ? '저장 중…' : '배정 저장'}
        </Button>
      </div>

      {sets.length === 0 || !active ? (
        <EmptyState
          title="저장된 모둠 배정이 없습니다"
          description="배정 세트를 만들고 모둠·모둠원을 입력하면, 활동을 시작할 때 세트 중 하나를 고를 수 있습니다."
          action={
            <Button variant="outline" onClick={() => setSets([emptySet('기본 편성')])}>
              <Plus className="size-4" />
              세트 만들기
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <Card className="py-4">
            <CardContent className="flex items-end gap-3 px-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="roster-set-name" className="text-xs">
                  세트 이름
                </Label>
                <Input
                  id="roster-set-name"
                  value={active.name}
                  onChange={(event) => updateSet(activeIndex, { name: event.target.value })}
                  placeholder="예: 1반 기본 편성"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={sets.length <= 1}
                onClick={() => {
                  const next = sets.filter((_, i) => i !== activeIndex)
                  setSets(next)
                  setActiveIndex(Math.max(0, activeIndex - 1))
                }}
                aria-label="세트 삭제"
              >
                <Trash2 className="size-4" />
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {active.groups.map((group, groupIndex) => (
              <Card key={groupIndex} className="py-4">
                <CardContent className="grid grid-cols-[minmax(0,220px)_1fr_auto] items-end gap-3 px-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={`roster-name-${groupIndex}`} className="text-xs">
                      모둠 이름
                    </Label>
                    <Input
                      id={`roster-name-${groupIndex}`}
                      value={group.name}
                      onChange={(event) =>
                        updateGroup(activeIndex, groupIndex, { name: event.target.value })
                      }
                      placeholder="예: 햇살"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`roster-students-${groupIndex}`} className="text-xs">
                      모둠원 ({parseStudents(group.studentsText).length}명)
                    </Label>
                    <Input
                      id={`roster-students-${groupIndex}`}
                      value={group.studentsText}
                      onChange={(event) =>
                        updateGroup(activeIndex, groupIndex, {
                          studentsText: event.target.value,
                        })
                      }
                      placeholder="이름을 쉼표로 구분해 입력"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      updateSet(activeIndex, {
                        groups: active.groups.filter((_, i) => i !== groupIndex),
                      })
                    }
                    disabled={active.groups.length <= 1}
                    aria-label={`${group.name || groupIndex + 1} 모둠 삭제`}
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
                updateSet(activeIndex, {
                  groups: [
                    ...active.groups,
                    { name: `${active.groups.length + 1}모둠`, studentsText: '' },
                  ],
                })
              }
            >
              <Plus className="size-4" />
              모둠 추가
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
