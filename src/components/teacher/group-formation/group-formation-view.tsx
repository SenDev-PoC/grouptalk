import {
  Check,
  ChevronDown,
  History,
  RotateCcw,
  Sparkles,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EmptyState } from '@/components/common/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { data } from '@/data'
import { executeGrouping } from '@/lib/group-formation'
import { cn } from '@/lib/utils'
import type {
  ArchivedGroupSet,
  ClassRoom,
  FormedGroup,
  GroupingOptions,
  RelationshipRule,
  Student,
} from '@/types/group-formation'

import { HistoryDialog } from './history-dialog'
import { SyncDialog } from './sync-dialog'
import { UnifiedClassDialog } from './unified-class-dialog'

export function GroupFormationView({
  teacherId,
  onOpenDashboard,
}: {
  teacherId: string
  onOpenDashboard?: () => void
}) {
  const [classes, setClasses] = useState<ClassRoom[] | null>(null)
  const [selectedClassId, setSelectedClassId] = useState('')
  const [loading, setLoading] = useState(true)

  const [options, setOptions] = useState<GroupingOptions>({
    groupMode: 'byCount',
    targetGroupCount: 3,
    targetGroupSize: 4,
    genderOption: 'balance',
    academicOption: 'hetero',
    engagementOption: 'hetero',
  })

  const [relationships, setRelationships] = useState<RelationshipRule[]>([])
  const [draftGroups, setDraftGroups] = useState<FormedGroup[]>([])

  const [draggedStudentId, setDraggedStudentId] = useState<string | null>(null)
  const [sourceGroupId, setSourceGroupId] = useState<number | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null)

  const [unifiedDialogOpen, setUnifiedDialogOpen] = useState(false)
  const [unifiedDialogMode, setUnifiedDialogMode] = useState<'create' | 'edit'>('edit')
  const [unifiedDialogStep, setUnifiedDialogStep] = useState<'roster' | 'criteria'>('roster')
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)

  const [classMenuOpen, setClassMenuOpen] = useState(false)
  const classMenuRef = useRef<HTMLDivElement>(null)

  const refreshClasses = useCallback(async () => {
    const list = await data().listClasses(teacherId)
    setClasses(list)
    setSelectedClassId((prev) => {
      if (prev && list.some((item) => item.id === prev)) return prev
      return list[0]?.id ?? ''
    })
    return list
  }, [teacherId])

  useEffect(() => {
    setLoading(true)
    void refreshClasses()
      .catch(() => setClasses([]))
      .finally(() => setLoading(false))
  }, [refreshClasses])

  useEffect(() => {
    if (!classMenuOpen) return
    function handlePointerDown(event: MouseEvent) {
      if (!classMenuRef.current?.contains(event.target as Node)) {
        setClassMenuOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setClassMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [classMenuOpen])

  const currentClass = useMemo(() => {
    if (!classes || classes.length === 0) return null
    return classes.find((c) => c.id === selectedClassId) || classes[0] || null
  }, [classes, selectedClassId])

  useEffect(() => {
    setRelationships(currentClass?.relationships ?? [])
  }, [currentClass?.id])

  const handleExecuteGrouping = useCallback(() => {
    if (!currentClass || currentClass.students.length === 0) {
      setDraftGroups([])
      return
    }
    const result = executeGrouping(currentClass.students, options, relationships)
    setDraftGroups(result)
  }, [currentClass, options, relationships])

  useEffect(() => {
    if (!currentClass) {
      setDraftGroups([])
      return
    }
    if (currentClass.activeGroupSet) {
      setDraftGroups(currentClass.activeGroupSet.groups)
    } else if (currentClass.students.length > 0) {
      setDraftGroups(executeGrouping(currentClass.students, options, relationships))
    } else {
      setDraftGroups([])
    }
  }, [currentClass?.id])

  function handleOpenRosterModal(mode: 'create' | 'edit' = 'edit') {
    setUnifiedDialogMode(mode)
    setUnifiedDialogStep('roster')
    setUnifiedDialogOpen(true)
  }

  function handleOpenCriteriaModal() {
    setUnifiedDialogStep('criteria')
    setUnifiedDialogOpen(true)
  }

  async function handleSaveClassAndStudents(payload: {
    id?: string
    name: string
    subject?: string
    students: Student[]
  }) {
    const saved = await data().upsertClass({
      teacherId,
      id: payload.id,
      name: payload.name,
      subject: payload.subject,
      students: payload.students,
      relationships: relationships.map((rule) => ({
        studentAId: rule.studentAId,
        studentBId: rule.studentBId,
        type: rule.type,
      })),
    })
    await refreshClasses()
    setSelectedClassId(saved.id)
    setRelationships(saved.relationships ?? [])
    setDraftGroups(
      saved.students.length > 0
        ? executeGrouping(saved.students, options, saved.relationships ?? [])
        : [],
    )
  }

  async function handleExecuteGroupingAndSave(classData: {
    id?: string
    name: string
    subject?: string
    students: Student[]
  }) {
    await handleSaveClassAndStudents(classData)
    const result = executeGrouping(classData.students, options, relationships)
    setDraftGroups(result)
  }

  function handleDrop(targetGroupId: number) {
    if (!draggedStudentId || sourceGroupId === null || sourceGroupId === targetGroupId) {
      setDraggedStudentId(null)
      setSourceGroupId(null)
      setDragOverGroupId(null)
      return
    }

    const targetStudent = currentClass?.students.find((s) => s.id === draggedStudentId)
    if (!targetStudent) return

    setDraftGroups((prev) =>
      prev.map((g) => {
        if (g.groupId === sourceGroupId) {
          return { ...g, members: g.members.filter((m) => m.id !== draggedStudentId) }
        }
        if (g.groupId === targetGroupId) {
          return { ...g, members: [...g.members, targetStudent] }
        }
        return g
      }),
    )

    setDraggedStudentId(null)
    setSourceGroupId(null)
    setDragOverGroupId(null)
  }

  async function handleSaveActive() {
    if (!currentClass || draftGroups.length === 0) return
    const updated = await data().confirmClassGroups({
      teacherId,
      classId: currentClass.id,
      title: `${new Date().toLocaleDateString('ko-KR')} 편성 조`,
      groups: draftGroups,
    })
    setClasses((prev) =>
      prev ? prev.map((item) => (item.id === updated.id ? updated : item)) : [updated],
    )
    setDraftGroups(updated.activeGroupSet?.groups ?? draftGroups)
  }

  async function handleRestoreSet(set: ArchivedGroupSet) {
    if (!currentClass) return
    setDraftGroups(set.groups)
    try {
      const updated = await data().restoreClassGroupSet(currentClass.id, set.id)
      setClasses((prev) =>
        prev ? prev.map((item) => (item.id === updated.id ? updated : item)) : [updated],
      )
    } catch {
      // draft already restored for preview
    }
  }

  const totalStudents = currentClass?.students.length || 0

  if (loading || classes === null) {
    return (
      <div className="text-muted-foreground flex min-h-40 items-center justify-center text-sm">
        학급 정보를 불러오는 중…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div ref={classMenuRef} className="relative">
            <Button
              type="button"
              variant="outline"
              aria-haspopup="listbox"
              aria-expanded={classMenuOpen}
              onClick={() => setClassMenuOpen((open) => !open)}
              className="min-w-[12rem] justify-between gap-3 px-3.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Users className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate">{currentClass?.name || '학급 선택'}</span>
              </span>
              <ChevronDown
                className={cn(
                  'text-muted-foreground size-4 shrink-0 transition-transform',
                  classMenuOpen && 'rotate-180',
                )}
              />
            </Button>

            {classMenuOpen ? (
              <div
                role="listbox"
                className="bg-card absolute top-[calc(100%+0.4rem)] left-0 z-40 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border shadow-lg"
              >
                <div className="max-h-64 overflow-y-auto p-1.5">
                  {classes.map((classroom) => {
                    const selected = classroom.id === currentClass?.id
                    return (
                      <button
                        key={classroom.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setSelectedClassId(classroom.id)
                          setClassMenuOpen(false)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                          selected
                            ? 'bg-accent text-foreground font-semibold'
                            : 'hover:bg-muted/70 text-foreground font-medium',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{classroom.name}</span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {classroom.students.length}명
                        </span>
                        {selected ? <Check className="text-primary size-4 shrink-0" /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <Button onClick={() => handleOpenRosterModal('edit')}>
            <Users className="size-4" />
            학급 및 명단 추가
          </Button>
        </div>

        <Button variant="ghost" onClick={() => setHistoryDialogOpen(true)}>
          <History className="size-4" />
          이전 편성 기록 ({currentClass?.archivedGroupSets?.length || 0})
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold tracking-tight">모둠 편성 결과 보드</h2>
            <Badge variant="secondary">
              {draftGroups.length}개 조 · {totalStudents}명
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleOpenCriteriaModal}>
              <Sparkles className="size-4" />
              새로 모둠 편성
            </Button>

            <Button
              variant="outline"
              onClick={handleExecuteGrouping}
              title="현재 조건으로 다시 섞기"
            >
              <RotateCcw className="size-4" />
              다시 섞기
            </Button>

            <Button onClick={handleSaveActive}>
              <Check className="size-4" />
              이 조로 확정
            </Button>
          </div>
        </div>

        {draftGroups.length === 0 ? (
          <EmptyState
            title="편성된 조가 없습니다"
            description="학급 및 학생을 등록한 후 새로 모둠 편성 버튼을 눌러주세요."
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleOpenRosterModal('edit')}>
                  학급·명단 관리
                </Button>
                <Button onClick={handleOpenCriteriaModal}>
                  <Sparkles className="size-4" />
                  새로 모둠 편성
                </Button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {draftGroups.map((group) => {
              const members = group.members
              const mCount = members.filter((m) => m.gender === 'M').length
              const fCount = members.filter((m) => m.gender === 'F').length
              const highCount = members.filter((m) => m.academicLevel === 'high').length
              const midCount = members.filter((m) => m.academicLevel === 'mid').length
              const lowCount = members.filter((m) => m.academicLevel === 'low').length
              const activeCount = members.filter((m) => m.engagement === 'active').length

              const isDropTarget = dragOverGroupId === group.groupId

              return (
                <div
                  key={group.groupId}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOverGroupId(group.groupId)
                  }}
                  onDragLeave={() => {
                    if (dragOverGroupId === group.groupId) {
                      setDragOverGroupId(null)
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleDrop(group.groupId)
                  }}
                  className={cn(
                    'bg-card flex flex-col justify-between rounded-xl border p-5 shadow-xs transition-colors',
                    isDropTarget && 'border-primary bg-primary/5 ring-primary/30 ring-2',
                  )}
                >
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-2 border-b pb-3">
                      <p className="truncate font-bold">{group.groupName}</p>
                      <Badge variant="secondary">{members.length}명</Badge>
                    </div>

                    <div className="bg-muted/60 text-muted-foreground mb-3 flex items-center justify-between rounded-md px-2.5 py-2 text-xs">
                      <span>
                        남{mCount}·여{fCount}
                      </span>
                      <span>
                        상{highCount}·중{midCount}·하{lowCount}
                      </span>
                      <span>적극{activeCount}</span>
                    </div>

                    <div className="min-h-[100px] space-y-2">
                      {members.length === 0 ? (
                        <div className="text-muted-foreground flex h-20 items-center justify-center rounded-lg border border-dashed text-sm">
                          학생을 드래그하세요
                        </div>
                      ) : (
                        members.map((s) => {
                          const isBeingDragged = draggedStudentId === s.id
                          return (
                            <div
                              key={s.id}
                              draggable
                              onDragStart={(e) => {
                                setDraggedStudentId(s.id)
                                setSourceGroupId(group.groupId)
                                e.dataTransfer.setData('text/plain', s.id)
                              }}
                              onDragEnd={() => {
                                setDraggedStudentId(null)
                                setSourceGroupId(null)
                                setDragOverGroupId(null)
                              }}
                              className={cn(
                                'bg-background flex cursor-grab items-center justify-between rounded-lg border px-3 py-2 text-sm shadow-xs transition hover:border-primary/40 active:cursor-grabbing',
                                isBeingDragged && 'scale-95 opacity-30',
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    'size-1.5 rounded-full',
                                    s.gender === 'M'
                                      ? 'bg-blue-500'
                                      : s.gender === 'F'
                                        ? 'bg-pink-500'
                                        : 'bg-muted-foreground',
                                  )}
                                />
                                {s.stuNum ? (
                                  <span className="text-muted-foreground tabular text-xs font-bold">
                                    {s.stuNum}번
                                  </span>
                                ) : null}
                                <span className="font-bold">{s.name}</span>
                              </div>

                              <div className="flex items-center gap-1 text-xs">
                                {s.academicLevel ? (
                                  <span
                                    className={cn(
                                      'rounded px-1.5 py-0.5 font-semibold',
                                      s.academicLevel === 'high'
                                        ? 'bg-purple-100 text-purple-800'
                                        : s.academicLevel === 'mid'
                                          ? 'bg-muted text-muted-foreground'
                                          : 'bg-amber-100 text-amber-800',
                                    )}
                                  >
                                    {s.academicLevel === 'high'
                                      ? '상'
                                      : s.academicLevel === 'mid'
                                        ? '중'
                                        : '하'}
                                  </span>
                                ) : null}
                                {s.engagement ? (
                                  <span
                                    className={cn(
                                      'rounded px-1.5 py-0.5 font-semibold',
                                      s.engagement === 'active'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : s.engagement === 'passive'
                                          ? 'bg-amber-100 text-amber-800'
                                          : 'bg-muted text-muted-foreground',
                                    )}
                                  >
                                    {s.engagement === 'active'
                                      ? '적극'
                                      : s.engagement === 'passive'
                                        ? '소극'
                                        : '보통'}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <UnifiedClassDialog
        open={unifiedDialogOpen}
        onOpenChange={setUnifiedDialogOpen}
        currentClass={currentClass}
        initialMode={unifiedDialogMode}
        initialStep={unifiedDialogStep}
        options={options}
        onOptionsChange={setOptions}
        relationships={relationships}
        onSetRelationships={setRelationships}
        onExecuteGroupingAndSave={handleExecuteGroupingAndSave}
      />

      <HistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        archivedSets={currentClass?.archivedGroupSets || []}
        onRestoreSet={handleRestoreSet}
      />

      <SyncDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        classId={currentClass?.id || ''}
        classNameTitle={currentClass?.name || ''}
        groups={draftGroups}
        onProceedToDashboard={onOpenDashboard}
      />
    </div>
  )
}
