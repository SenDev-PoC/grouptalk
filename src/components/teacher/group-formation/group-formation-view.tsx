import {
  Check,
  History,
  RotateCcw,
  Sparkles,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { data } from '@/data'
import { executeGrouping } from '@/lib/group-formation'
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

const STORAGE_KEY = 'SMART_GROUPING_STORE_V3'

const INITIAL_DEFAULT_CLASSES: ClassRoom[] = [
  {
    id: 'cls_1',
    name: '1학년 3반',
    subject: '통합사회',
    students: [
      { id: 's1', stuNum: 1, name: '김민준', gender: 'M', academicLevel: 'high', engagement: 'active' },
      { id: 's2', stuNum: 2, name: '이지은', gender: 'F', academicLevel: 'mid', engagement: 'moderate' },
      { id: 's3', stuNum: 3, name: '박서준', gender: 'M', academicLevel: 'low', engagement: 'passive' },
      { id: 's4', stuNum: 4, name: '최수빈', gender: 'F', academicLevel: 'high', engagement: 'moderate' },
      { id: 's5', stuNum: 5, name: '정예원', gender: 'F', academicLevel: 'mid', engagement: 'active' },
      { id: 's6', stuNum: 6, name: '강동현', gender: 'M', academicLevel: 'high', engagement: 'passive' },
      { id: 's7', stuNum: 7, name: '윤도윤', gender: 'M', academicLevel: 'low', engagement: 'moderate' },
      { id: 's8', stuNum: 8, name: '임서아', gender: 'F', academicLevel: 'mid', engagement: 'active' },
      { id: 's9', stuNum: 9, name: '한지호', gender: 'M', academicLevel: 'high', engagement: 'moderate' },
      { id: 's10', stuNum: 10, name: '송하은', gender: 'F', academicLevel: 'low', engagement: 'passive' },
      { id: 's11', stuNum: 11, name: '조유진', gender: 'F', academicLevel: 'mid', engagement: 'active' },
      { id: 's12', stuNum: 12, name: '배준우', gender: 'M', academicLevel: 'mid', engagement: 'moderate' },
    ],
    activeGroupSet: null,
    archivedGroupSets: [],
  },
]

function loadInitialClasses(): ClassRoom[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch (e) {
    console.warn('Failed to parse localStorage classes:', e)
  }
  return INITIAL_DEFAULT_CLASSES
}

export function GroupFormationView({
  teacherId,
  onOpenDashboard,
}: {
  teacherId: string
  onOpenDashboard?: () => void
}) {
  const [classes, setClasses] = useState<ClassRoom[]>(loadInitialClasses)
  const [selectedClassId, setSelectedClassId] = useState<string>(() => classes[0]?.id || '')

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

  // Drag & drop state
  const [draggedStudentId, setDraggedStudentId] = useState<string | null>(null)
  const [sourceGroupId, setSourceGroupId] = useState<number | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null)

  // Dialogs
  const [unifiedDialogOpen, setUnifiedDialogOpen] = useState(false)
  const [unifiedDialogMode, setUnifiedDialogMode] = useState<'create' | 'edit' | 'manage'>('edit')
  const [unifiedDialogStep, setUnifiedDialogStep] = useState<'roster' | 'criteria'>('roster')
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [syncDialogOpen, setSyncDialogOpen] = useState(false)

  // Current selected class
  const currentClass = useMemo(() => {
    return classes.find((c) => c.id === selectedClassId) || classes[0] || null
  }, [classes, selectedClassId])

  // Save to localStorage
  const persistClasses = useCallback((newClasses: ClassRoom[]) => {
    setClasses(newClasses)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newClasses))
    } catch (e) {
      console.warn('Failed to save to localStorage:', e)
    }
  }, [])

  // Execute grouping
  const handleExecuteGrouping = useCallback(() => {
    if (!currentClass || currentClass.students.length === 0) {
      setDraftGroups([])
      return
    }
    const result = executeGrouping(currentClass.students, options, relationships)
    setDraftGroups(result)
    toast.success('✨ 조 편성을 다시 실행했습니다.')
  }, [currentClass, options, relationships])

  // Run initial grouping or load active group on switch
  useEffect(() => {
    if (!currentClass) {
      setDraftGroups([])
      return
    }
    if (currentClass.activeGroupSet) {
      setDraftGroups(currentClass.activeGroupSet.groups)
    } else {
      const result = executeGrouping(currentClass.students, options, relationships)
      setDraftGroups(result)
    }
  }, [currentClass?.id])

  // Open modal at Step 1 (Roster Management)
  function handleOpenRosterModal(mode: 'create' | 'edit' = 'edit') {
    setUnifiedDialogMode(mode)
    setUnifiedDialogStep('roster')
    setUnifiedDialogOpen(true)
  }

  // Open modal at Step 2 (Criteria Settings)
  function handleOpenCriteriaModal() {
    setUnifiedDialogStep('criteria')
    setUnifiedDialogOpen(true)
  }

  // Unified Save Handler (Class Info + Students)
  function handleSaveClassAndStudents(data: {
    id?: string
    name: string
    subject?: string
    students: Student[]
  }) {
    if (data.id) {
      // Edit existing class
      const targetClass = classes.find((c) => c.id === data.id)
      if (!targetClass) return

      const updatedClass: ClassRoom = {
        ...targetClass,
        name: data.name,
        subject: data.subject,
        students: data.students,
        activeGroupSet: null,
      }
      const updatedClasses = classes.map((c) => (c.id === data.id ? updatedClass : c))
      persistClasses(updatedClasses)
      const result = executeGrouping(data.students, options, relationships)
      setDraftGroups(result)
    } else {
      // Create new class
      const newClassId = `cls_${Date.now()}`
      const newClass: ClassRoom = {
        id: newClassId,
        name: data.name,
        subject: data.subject,
        students: data.students,
        activeGroupSet: null,
        archivedGroupSets: [],
      }
      const updatedClasses = [...classes, newClass]
      persistClasses(updatedClasses)
      setSelectedClassId(newClassId)
      const result = executeGrouping(data.students, options, relationships)
      setDraftGroups(result)
    }
  }

  function handleExecuteGroupingAndSave(classData: {
    id?: string
    name: string
    subject?: string
    students: Student[]
  }) {
    handleSaveClassAndStudents(classData)
    const result = executeGrouping(classData.students, options, relationships)
    setDraftGroups(result)
    toast.success(`✨ '${classData.name}' 조 편성이 완료되었습니다.`)
  }

  function handleDeleteClass(classId: string) {
    const target = classes.find((c) => c.id === classId)
    const updated = classes.filter((c) => c.id !== classId)
    persistClasses(updated)
    if (selectedClassId === classId) {
      setSelectedClassId(updated[0]?.id || '')
    }
    toast.success(`'${target?.name || ''}' 학급이 삭제되었습니다.`)
  }

  // Drag and drop handler
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

    toast.success(`'${targetStudent.name}' 이동 완료`)
    setDraggedStudentId(null)
    setSourceGroupId(null)
    setDragOverGroupId(null)
  }

  // Save current as Active and sync to data()
  async function handleSaveActive() {
    if (!currentClass || draftGroups.length === 0) return

    const newSet: ArchivedGroupSet = {
      id: `gset_${Date.now()}`,
      title: `${new Date().toLocaleDateString('ko-KR')} 편성 조`,
      createdAt: new Date().toLocaleString('ko-KR'),
      groups: draftGroups,
    }

    const archived = [...(currentClass.archivedGroupSets || [])]
    if (currentClass.activeGroupSet) {
      archived.unshift(currentClass.activeGroupSet)
    }

    const updatedClass: ClassRoom = {
      ...currentClass,
      activeGroupSet: newSet,
      archivedGroupSets: archived,
    }

    const updatedClasses = classes.map((c) => (c.id === currentClass.id ? updatedClass : c))
    persistClasses(updatedClasses)

    // Also sync to backend/demo roster
    try {
      const rosterInput = draftGroups.map((g) => ({
        name: g.groupName,
        students: g.members.map((m) => m.name),
      }))
      await data().saveRoster(teacherId, rosterInput)
      toast.success('💾 현재 조가 확정되었으며, 모둠뷰 수업 배정에 연동되었습니다!')
    } catch {
      toast.success('💾 현재 조가 확정되었습니다.')
    }
  }

  // Restore archived set
  function handleRestoreSet(set: ArchivedGroupSet) {
    setDraftGroups(set.groups)
    toast.success(`'${set.title}' 조를 불러왔습니다.`)
  }

  const totalStudents = currentClass?.students.length || 0

  return (
    <div className="space-y-4">
      {/* Top Bar Header & Class Selection */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Class Select Dropdown */}
          <div className="flex items-center rounded-lg border bg-muted/50 px-1 py-0.5">
            <select
              value={selectedClassId}
              onChange={(e) => {
                if (e.target.value === '__NEW__') {
                  handleOpenRosterModal('create')
                  return
                }
                setSelectedClassId(e.target.value)
              }}
              className="h-7 bg-transparent px-1.5 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__NEW__">+ 새 학급 추가…</option>
            </select>
          </div>

          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs font-semibold shadow-2xs"
            onClick={() => handleOpenRosterModal('edit')}
          >
            <Users className="size-3.5" />
            <span>학급 및 명단 추가</span>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-primary underline-offset-4 hover:underline"
          onClick={() => setHistoryDialogOpen(true)}
        >
          <History className="size-3.5" />
          <span>이전 편성 기록 ({currentClass?.archivedGroupSets?.length || 0})</span>
        </Button>
      </div>

      {/* Active Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2 font-medium">
          <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
          <span>
            {currentClass?.activeGroupSet
              ? `현재 확정된 조 [${currentClass.activeGroupSet.title}]가 유지 중입니다. 수업 활동을 시작할 때 바로 적용됩니다.`
              : '아직 확정된 조가 없습니다. [새로 조편성] 버튼을 눌러 조건을 설정하고 편성한 뒤 확정해주세요.'}
          </span>
        </div>

        {onOpenDashboard && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs font-semibold text-primary hover:bg-primary/10"
            onClick={onOpenDashboard}
          >
            <span>대시보드로 진입하기 →</span>
          </Button>
        )}
      </div>

      {/* Main Full-Width Results Workspace */}
      <div className="space-y-3">
        {/* Result Board Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">조 편성 결과 보드</span>
            <Badge variant="secondary" className="px-2 text-xs">
              {draftGroups.length}개 조 ({totalStudents}명)
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-semibold shadow-2xs"
              onClick={handleOpenCriteriaModal}
            >
              <Sparkles className="size-3.5" />
              <span>새로 조편성</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={handleExecuteGrouping}
              title="현재 조건으로 다시 섞기"
            >
              <RotateCcw className="size-3.5" />
              <span>다시 섞기</span>
            </Button>

            <Button
              size="sm"
              className="h-8 gap-1 bg-emerald-600 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-700"
              onClick={handleSaveActive}
            >
              <Check className="size-3.5" />
              <span>이 조로 확정 (Active)</span>
            </Button>
          </div>
        </div>

        {/* Group Cards Grid */}
        {draftGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center text-muted-foreground">
            <Users className="mb-2 size-10 opacity-40" />
            <p className="text-sm font-semibold">편성된 조가 없습니다.</p>
            <p className="mb-4 text-xs opacity-70">
              학급 및 학생을 등록한 후 [새로 조편성] 버튼을 눌러주세요.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => handleOpenRosterModal('edit')}
              >
                학급·명단 관리
              </Button>
              <Button size="sm" className="gap-1.5 text-xs font-semibold" onClick={handleOpenCriteriaModal}>
                <Sparkles className="size-3.5" />
                <span>새로 조편성</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                  className={`flex flex-col justify-between rounded-xl border p-3.5 shadow-2xs transition-all ${
                    isDropTarget
                      ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                      : 'bg-card'
                  }`}
                >
                  <div>
                    {/* Card Header */}
                    <div className="mb-2 flex items-center justify-between border-b pb-2">
                      <span className="text-xs font-bold text-foreground">{group.groupName}</span>
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {members.length}명
                      </Badge>
                    </div>

                    {/* Mini Stats */}
                    <div className="mb-2.5 flex items-center justify-between rounded-md bg-muted/60 p-1.5 text-[10px] text-muted-foreground">
                      <span>
                        남{mCount}·여{fCount}
                      </span>
                      <span>
                        상{highCount}·중{midCount}·하{lowCount}
                      </span>
                      <span>적극{activeCount}</span>
                    </div>

                    {/* Student Chips */}
                    <div className="min-h-[100px] space-y-1.5">
                      {members.length === 0 ? (
                        <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-[11px] text-muted-foreground">
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
                              className={`flex cursor-grab items-center justify-between rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-2xs transition hover:border-primary/40 active:cursor-grabbing ${
                                isBeingDragged ? 'scale-95 opacity-30' : ''
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`size-1.5 rounded-full ${
                                    s.gender === 'M'
                                      ? 'bg-blue-500'
                                      : s.gender === 'F'
                                        ? 'bg-pink-500'
                                        : 'bg-muted-foreground'
                                  }`}
                                />
                                {s.stuNum && (
                                  <span className="font-mono text-[10px] font-bold text-muted-foreground">
                                    {s.stuNum}번
                                  </span>
                                )}
                                <span className="font-bold">{s.name}</span>
                              </div>

                              <div className="flex items-center gap-1 text-[10px]">
                                {s.academicLevel && (
                                  <span
                                    className={`rounded px-1 py-0.5 font-semibold ${
                                      s.academicLevel === 'high'
                                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                                        : s.academicLevel === 'mid'
                                          ? 'bg-muted text-muted-foreground'
                                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                    }`}
                                  >
                                    {s.academicLevel === 'high'
                                      ? '상'
                                      : s.academicLevel === 'mid'
                                        ? '중'
                                        : '하'}
                                  </span>
                                )}
                                {s.engagement && (
                                  <span
                                    className={`rounded px-1 py-0.5 font-semibold ${
                                      s.engagement === 'active'
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                        : s.engagement === 'passive'
                                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                          : 'bg-muted text-muted-foreground'
                                    }`}
                                  >
                                    {s.engagement === 'active'
                                      ? '적극'
                                      : s.engagement === 'passive'
                                        ? '소극'
                                        : '보통'}
                                  </span>
                                )}
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

      {/* Unified Class & Student & Criteria Management Wizard Modal */}
      <UnifiedClassDialog
        open={unifiedDialogOpen}
        onOpenChange={setUnifiedDialogOpen}
        classes={classes}
        currentClass={currentClass}
        initialMode={unifiedDialogMode}
        initialStep={unifiedDialogStep}
        options={options}
        onOptionsChange={setOptions}
        relationships={relationships}
        onSetRelationships={setRelationships}
        onExecuteGroupingAndSave={handleExecuteGroupingAndSave}
        onSelectClass={setSelectedClassId}
        onDeleteClass={handleDeleteClass}
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
