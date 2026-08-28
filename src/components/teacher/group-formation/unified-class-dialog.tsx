import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  FolderCog,
  GitCommit,
  Plus,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { downloadSampleCsvTemplate, parseStudentFile, parseTextRoster } from '@/lib/excel-helper'
import type {
  AcademicLevel,
  ClassRoom,
  EngagementLevel,
  Gender,
  GroupingOptions,
  RelationshipRule,
  Student,
} from '@/types/group-formation'

interface UnifiedClassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: ClassRoom[]
  currentClass: ClassRoom | null
  initialMode?: 'create' | 'edit' | 'manage'
  initialStep?: 'roster' | 'criteria'
  options: GroupingOptions
  onOptionsChange: React.Dispatch<React.SetStateAction<GroupingOptions>>
  relationships: RelationshipRule[]
  onSetRelationships: React.Dispatch<React.SetStateAction<RelationshipRule[]>>
  onExecuteGroupingAndSave: (classData: {
    id?: string
    name: string
    subject?: string
    students: Student[]
  }) => void
  onSelectClass: (classId: string) => void
  onDeleteClass: (classId: string) => void
}

export function UnifiedClassDialog({
  open,
  onOpenChange,
  classes,
  currentClass,
  initialMode = 'edit',
  initialStep = 'roster',
  options,
  onOptionsChange,
  relationships,
  onSetRelationships,
  onExecuteGroupingAndSave,
  onSelectClass,
  onDeleteClass,
}: UnifiedClassDialogProps) {
  // Wizard Step State
  const [currentStep, setCurrentStep] = useState<'roster' | 'criteria'>('roster')
  const [activeTab, setActiveTab] = useState<'form' | 'list'>('form')
  const [mode, setMode] = useState<'create' | 'edit'>('edit')

  // Form State (Roster)
  const [className, setClassName] = useState('')
  const [subject, setSubject] = useState('')
  const [students, setStudents] = useState<Student[]>([])

  // Input Methods State
  const [pasteText, setPasteText] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  // Direct Add Row State
  const [quickNum, setQuickNum] = useState('')
  const [quickName, setQuickName] = useState('')
  const [quickGender, setQuickGender] = useState<Gender | ''>('')
  const [quickAcademic, setQuickAcademic] = useState<AcademicLevel | ''>('')
  const [quickEngagement, setQuickEngagement] = useState<EngagementLevel | ''>('')

  // Relationship Rule Form in Step 2
  const [relOpen, setRelOpen] = useState(false)
  const [relStudentA, setRelStudentA] = useState('')
  const [relStudentB, setRelStudentB] = useState('')
  const [relType, setRelType] = useState<RelationshipRule['type']>('mustSeparate')

  // Synchronize when modal opens or currentClass changes
  useEffect(() => {
    if (open) {
      setCurrentStep(initialStep)
      if (initialMode === 'create' || !currentClass) {
        setMode('create')
        setClassName('')
        setSubject('')
        setStudents([])
        setActiveTab('form')
      } else if (initialMode === 'manage') {
        setActiveTab('list')
      } else {
        setMode('edit')
        setClassName(currentClass.name.split(' (')[0] || currentClass.name)
        setSubject(currentClass.subject || '')
        setStudents([...currentClass.students])
        setActiveTab('form')
      }
      setPasteText('')
    }
  }, [open, currentClass, initialMode, initialStep])

  // Sync relationship selection defaults with current students
  useEffect(() => {
    if (students.length >= 2) {
      setRelStudentA((prev) => (students.some((s) => s.id === prev) ? prev : students[0].id))
      setRelStudentB((prev) =>
        students.some((s) => s.id === prev && prev !== students[0].id) ? prev : students[1].id,
      )
    } else {
      setRelStudentA('')
      setRelStudentB('')
    }
  }, [students])

  function handleStartNewClass() {
    setMode('create')
    setClassName('')
    setSubject('')
    setStudents([])
    setPasteText('')
    setActiveTab('form')
    setCurrentStep('roster')
  }

  function handleLoadExistingClass(cls: ClassRoom) {
    onSelectClass(cls.id)
    setMode('edit')
    setClassName(cls.name.split(' (')[0] || cls.name)
    setSubject(cls.subject || '')
    setStudents([...cls.students])
    setActiveTab('form')
  }

  // Parse pasted text and merge into student list
  function handleParsePasteText() {
    if (!pasteText.trim()) {
      toast.error('붙여넣을 학생 명단 텍스트를 입력해주세요.')
      return
    }
    const parsed = parseTextRoster(pasteText)
    if (parsed.length === 0) {
      toast.error('텍스트에서 학생 이름을 찾지 못했습니다.')
      return
    }
    setStudents((prev) => [...prev, ...parsed])
    setPasteText('')
    toast.success(`학생 ${parsed.length}명을 명단에 추가했습니다.`)
  }

  // Handle Excel / CSV upload
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      const parsed = await parseStudentFile(file)
      if (parsed.length > 0) {
        setStudents((prev) => [...prev, ...parsed])
        toast.success(`파일에서 학생 ${parsed.length}명을 불러왔습니다.`)
      } else {
        toast.error('파일에서 학생 데이터를 읽지 못했습니다.')
      }
    } catch {
      toast.error('파일을 읽는 중 오류가 발생했습니다.')
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }

  // Direct manual add student
  function handleDirectAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!quickName.trim()) return

    const newStudent: Student = {
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      stuNum: quickNum ? Number(quickNum) : students.length + 1,
      name: quickName.trim(),
      gender: quickGender || null,
      academicLevel: quickAcademic || null,
      engagement: quickEngagement || null,
    }

    setStudents((prev) => [...prev, newStudent])
    setQuickName('')
    setQuickNum('')
    setQuickGender('')
    setQuickAcademic('')
    setQuickEngagement('')
    toast.success(`'${newStudent.name}' 학생이 추가되었습니다.`)
  }

  function handleDeleteStudent(id: string) {
    setStudents((prev) => prev.filter((s) => s.id !== id))
  }

  function handleClearAllStudents() {
    if (confirm('현재 입력된 학생 명단을 모두 비우시겠습니까?')) {
      setStudents([])
    }
  }

  // Step 1 -> Step 2 validation & transition
  function handleProceedToCriteria() {
    if (!className.trim()) {
      toast.error('학년·반(학급명)을 입력해주세요.')
      return
    }
    if (students.length === 0) {
      toast.error('최소 1명 이상의 학생을 등록해주세요.')
      return
    }
    setCurrentStep('criteria')
  }

  // Relationship Rule Handlers
  function handleAddRelationship() {
    if (!relStudentA || !relStudentB) {
      toast.error('학생 명단을 먼저 선택해주세요.')
      return
    }
    if (relStudentA === relStudentB) {
      toast.error('서로 다른 두 학생을 선택해주세요.')
      return
    }
    const exists = relationships.some(
      (r) =>
        (r.studentAId === relStudentA && r.studentBId === relStudentB) ||
        (r.studentAId === relStudentB && r.studentBId === relStudentA),
    )
    if (exists) {
      toast.error('이미 등록된 학생 관계 규칙입니다.')
      return
    }

    const newRule: RelationshipRule = {
      id: `r_${Date.now()}`,
      studentAId: relStudentA,
      studentBId: relStudentB,
      type: relType,
    }
    onSetRelationships((prev) => [...prev, newRule])
    toast.success('관계 규칙이 추가되었습니다.')
  }

  function handleRemoveRelationship(id: string) {
    onSetRelationships((prev) => prev.filter((r) => r.id !== id))
  }

  // Final Execution in Step 2: Save and Run Grouping
  function handleFinalExecuteGrouping() {
    if (!className.trim()) {
      toast.error('학년·반(학급명)을 입력해주세요.')
      return
    }

    const fullName = subject.trim() ? `${className.trim()} (${subject.trim()})` : className.trim()
    const classPayload = {
      id: mode === 'edit' && currentClass ? currentClass.id : undefined,
      name: fullName,
      subject: subject.trim() || undefined,
      students,
    }

    onExecuteGroupingAndSave(classPayload)
    onOpenChange(false)
  }

  const totalStudents = students.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[95vw] max-w-4xl flex-col overflow-hidden p-4 sm:p-5">
        {/* Dialog Header & Stepper */}
        <DialogHeader className="border-b pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base font-bold text-foreground">
              <FolderCog className="size-4.5 text-primary" />
              <span>학급 및 모둠 편성</span>
            </DialogTitle>

            {/* Step Indicators */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentStep('roster')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${currentStep === 'roster'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
              >
                <span className="flex size-4 items-center justify-center rounded-full bg-background/20 text-[10px]">
                  1
                </span>
                <span>학급·명단 관리</span>
              </button>

              <span className="text-muted-foreground text-xs">→</span>

              <button
                type="button"
                onClick={handleProceedToCriteria}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${currentStep === 'criteria'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
              >
                <span className="flex size-4 items-center justify-center rounded-full bg-background/20 text-[10px]">
                  2
                </span>
                <span>조 편성 기준 설정</span>
              </button>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {currentStep === 'roster'
              ? '학급 정보와 학생 명단을 등록하고 [다음]을 눌러 조 편성 기준을 설정하세요.'
              : '인원수, 성별, 학업 수준, 발화도 및 학생 간 관계 규칙을 설정한 후 조 편성을 실행합니다.'}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: Roster Management */}
        {currentStep === 'roster' && (
          <>
            <div className="flex items-center justify-between border-b pb-2 pt-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {mode === 'create' ? '새 학급 등록' : `${className || '학급'} 명단 관리`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant={activeTab === 'form' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2.5 text-xs font-medium"
                  onClick={() => setActiveTab('form')}
                >
                  {mode === 'create' ? '+ 새 학급 작성' : '명단 작성·편집'}
                </Button>
                <Button
                  variant={activeTab === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2.5 text-xs font-medium"
                  onClick={() => setActiveTab('list')}
                >
                  전체 학급 목록 ({classes.length})
                </Button>
              </div>
            </div>

            {activeTab === 'list' ? (
              /* Tab: Existing Classes List */
              <div className="flex-1 space-y-2.5 overflow-y-auto py-1 pr-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    등록된 학급 중 편집할 학급을 선택하거나 새 학급을 개설하세요.
                  </p>
                  <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleStartNewClass}>
                    <Plus className="size-3.5" />
                    새 학급 개설하기
                  </Button>
                </div>

                <div className="space-y-2">
                  {classes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center text-xs text-muted-foreground">
                      <Users className="mb-2 size-8 opacity-40" />
                      <span>등록된 학급이 없습니다. [새 학급 개설하기]를 눌러 등록해보세요.</span>
                    </div>
                  ) : (
                    classes.map((cls) => {
                      const isSelected = cls.id === currentClass?.id
                      return (
                        <div
                          key={cls.id}
                          className={`flex items-center justify-between rounded-xl border p-3 shadow-2xs transition ${isSelected ? 'border-primary/50 bg-primary/5' : 'bg-card'
                            }`}
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-foreground">{cls.name}</span>
                              {isSelected && (
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                  현재 선택됨
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              학생 {cls.students.length}명 · 확정 조: {cls.activeGroupSet ? '있음' : '없음'}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-xs font-medium"
                              onClick={() => handleLoadExistingClass(cls)}
                            >
                              선택 및 편집
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => onDeleteClass(cls.id)}
                              aria-label={`${cls.name} 학급 삭제`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            ) : (
              /* Tab: Unified Form (Class Info + Roster Input Methods + Live Table) */
              <div className="flex-1 space-y-3 overflow-y-auto py-1 pr-1">
                {/* Class Basic Info */}
                <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground">
                        1
                      </span>
                      <span>학급 기본 정보</span>
                    </span>
                    {mode === 'edit' && (
                      <button
                        type="button"
                        onClick={handleStartNewClass}
                        className="text-[11px] font-semibold text-primary hover:underline"
                      >
                        + 새 학급 개설하기
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label
                        htmlFor="class-name-input"
                        className="text-[11px] font-medium text-muted-foreground"
                      >
                        학년·반 (필수)
                      </Label>
                      <Input
                        id="class-name-input"
                        value={className}
                        onChange={(e) => setClassName(e.target.value)}
                        placeholder="예: 1학년 3반, 2-1반"
                        className="h-7.5 text-xs font-medium"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="class-subject-input"
                        className="text-[11px] font-medium text-muted-foreground"
                      >
                        과목 / 활동명 (선택)
                      </Label>
                      <Input
                        id="class-subject-input"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="예: 통합사회, 과학탐구, 진로활동"
                        className="h-7.5 text-xs font-medium"
                      />
                    </div>
                  </div>
                </div>

                {/* Student Roster Input Methods (Tabs) */}
                <div className="space-y-3 rounded-xl border bg-card p-3 shadow-2xs">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground">
                        2
                      </span>
                      <span>학생 명단 등록</span>
                    </span>
                    <Badge variant="outline" className="text-[10px] font-semibold">
                      등록된 학생 {students.length}명
                    </Badge>
                  </div>

                  <Tabs defaultValue="paste" className="w-full">
                    {/* High-visibility Segmented Tab Bar */}
                    <TabsList className="grid h-10 w-full grid-cols-3 gap-1 rounded-xl bg-muted/80 p-1 border border-border/80 shadow-2xs">
                      <TabsTrigger
                        value="paste"
                        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background/60 data-[state=inactive]:hover:text-foreground cursor-pointer"
                      >
                        <FileText className="size-4" />
                        <span>텍스트 붙여넣기</span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="file"
                        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background/60 data-[state=inactive]:hover:text-foreground cursor-pointer"
                      >
                        <FileSpreadsheet className="size-4" />
                        <span>엑셀 파일 추가</span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="direct"
                        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-background/60 data-[state=inactive]:hover:text-foreground cursor-pointer"
                      >
                        <UserPlus className="size-4" />
                        <span>1명씩 직접 추가</span>
                      </TabsTrigger>
                    </TabsList>

                    {/* Sub-tab 1: Quick Text Paste */}
                    <TabsContent value="paste" className="space-y-2 pt-2">
                      <div className="text-[11px] leading-relaxed text-muted-foreground">
                        나이스(NEIS)나 한글/메모장의 명단을 복사해 아래에 붙여넣으세요. 이름만
                        나열하거나{' '}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                          1 김민준 남 상 적극
                        </code>{' '}
                        형식 모두 자동으로 인식되어 등록됩니다.
                      </div>
                      <textarea
                        rows={3}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder="예시 1: 김민준, 이지은, 박서준, 최수빈&#10;예시 2:&#10;1 김민준 남 상 적극&#10;2 이지은 여 중 보통&#10;3 박서준 남 하 소극"
                        className="w-full rounded-lg border bg-muted/20 p-2 font-mono text-xs focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 gap-1.5 px-4 text-xs font-bold shadow-2xs"
                          onClick={handleParsePasteText}
                        >
                          <Sparkles className="size-3.5" />
                          텍스트 명단 추가
                        </Button>
                      </div>
                    </TabsContent>

                    {/* Sub-tab 2: File Upload */}
                    <TabsContent value="file" className="space-y-2 pt-2">
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
                        {/* Clickable Card to Select and Upload File */}
                        <label
                          className={`group flex flex-1 w-full cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3 text-xs transition ${isUploading
                            ? 'border-primary/60 bg-primary/10 opacity-75'
                            : 'border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10'
                            }`}
                        >
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs group-hover:scale-105 transition-transform">
                            <FileSpreadsheet className="size-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 font-bold text-foreground">
                              <span>{isUploading ? '파일 불러오는 중…' : '엑셀(Excel) 또는 CSV 파일 업로드'}</span>
                              <span className="text-[11px] font-normal text-primary underline underline-offset-2">
                                (클릭하여 파일 선택)
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              .xlsx, .xls, .csv 지원 · 드롭다운 전용 양식 지원
                            </p>
                          </div>

                          <input
                            type="file"
                            accept=".xlsx,.xls,.csv,.txt"
                            className="hidden"
                            onChange={handleFileUpload}
                            disabled={isUploading}
                          />
                        </label>

                        {/* Sample Template Download Button */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-10 w-full sm:w-auto shrink-0 gap-1.5 rounded-xl px-3.5 text-xs font-semibold shadow-2xs hover:bg-accent cursor-pointer"
                          onClick={downloadSampleCsvTemplate}
                          title="성별/학업수준/발화정도 드롭다운이 적용된 엑셀 양식 다운로드"
                        >
                          <Download className="size-4 text-primary" />
                          <span>엑셀 양식 다운로드 (.xlsx)</span>
                        </Button>
                      </div>
                    </TabsContent>

                    {/* Sub-tab 3: Direct Manual Add */}
                    <TabsContent value="direct" className="space-y-2 pt-2">
                      <p className="text-[11px] text-muted-foreground">
                        학생의 번호, 이름, 성별, 학업수준, 발화도를 직접 입력하여 1명씩 등록합니다.
                      </p>
                      <form onSubmit={handleDirectAdd} className="grid grid-cols-12 gap-1.5 text-xs">
                        <Input
                          placeholder="번호"
                          value={quickNum}
                          onChange={(e) => setQuickNum(e.target.value)}
                          className="col-span-2 sm:col-span-1 h-8 text-xs font-mono px-1 text-center"
                          type="number"
                        />
                        <Input
                          placeholder="이름 (필수)"
                          value={quickName}
                          onChange={(e) => setQuickName(e.target.value)}
                          className="col-span-4 sm:col-span-3 h-8 text-xs font-medium px-2"
                          required
                        />
                        <select
                          value={quickGender}
                          onChange={(e) => setQuickGender(e.target.value as Gender | '')}
                          className="col-span-3 sm:col-span-2 h-8 rounded-md border bg-background px-1 text-[11px] font-medium"
                        >
                          <option value="">성별(선택)</option>
                          <option value="M">남</option>
                          <option value="F">여</option>
                        </select>
                        <select
                          value={quickAcademic}
                          onChange={(e) =>
                            setQuickAcademic(e.target.value as AcademicLevel | '')
                          }
                          className="col-span-3 sm:col-span-2 h-8 rounded-md border bg-background px-1 text-[11px] font-medium"
                        >
                          <option value="">학업수준(선택)</option>
                          <option value="high">상</option>
                          <option value="mid">중</option>
                          <option value="low">하</option>
                        </select>
                        <select
                          value={quickEngagement}
                          onChange={(e) =>
                            setQuickEngagement(e.target.value as EngagementLevel | '')
                          }
                          className="col-span-6 sm:col-span-3 h-8 rounded-md border bg-background px-1 text-[11px] font-medium"
                        >
                          <option value="">참여·발화(선택)</option>
                          <option value="active">적극</option>
                          <option value="moderate">보통</option>
                          <option value="passive">소극</option>
                        </select>
                        <Button
                          type="submit"
                          size="sm"
                          className="col-span-6 sm:col-span-1 h-8 gap-0.5 p-0 text-xs font-bold shadow-2xs"
                          title="학생 추가"
                        >
                          <Plus className="size-3.5" />
                          <span className="sm:hidden text-xs font-bold">추가</span>
                        </Button>
                      </form>
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Real-time Student Roster Table */}
                <div className="space-y-2 rounded-xl border bg-card p-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground">
                        3
                      </span>
                      <span>등록된 학생 명단 확인</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        ({students.length}명)
                      </span>
                    </span>
                    {students.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-destructive hover:bg-destructive/10"
                        onClick={handleClearAllStudents}
                      >
                        명단 전체 비우기
                      </Button>
                    )}
                  </div>

                  <div className="max-h-52 overflow-y-auto rounded-lg border">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 border-b bg-muted/80 font-semibold text-muted-foreground">
                        <tr>
                          <th className="w-12 px-2.5 py-1.5 text-center">번호</th>
                          <th className="px-2.5 py-1.5">학생명</th>
                          <th className="px-2.5 py-1.5 text-center">성별</th>
                          <th className="px-2.5 py-1.5 text-center">학업수준</th>
                          <th className="px-2.5 py-1.5 text-center">참여·발화</th>
                          <th className="w-10 px-2 py-1.5 text-center">삭제</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {students.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                              아직 등록된 학생이 없습니다. 위 탭에서 텍스트를 붙여넣거나 파일을
                              올려주세요.
                            </td>
                          </tr>
                        ) : (
                          students.map((s, idx) => (
                            <tr key={s.id} className="hover:bg-muted/30">
                              <td className="px-2.5 py-1 text-center font-mono text-xs text-muted-foreground">
                                {s.stuNum ?? idx + 1}
                              </td>
                              <td className="px-2.5 py-1 font-medium text-foreground">{s.name}</td>
                              <td className="px-2.5 py-1 text-center">
                                {s.gender === 'M' ? (
                                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-blue-600 dark:text-blue-400">
                                    남
                                  </Badge>
                                ) : s.gender === 'F' ? (
                                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-pink-600 dark:text-pink-400">
                                    여
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="px-2.5 py-1 text-center">
                                {s.academicLevel ? (
                                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                    {s.academicLevel === 'high'
                                      ? '상'
                                      : s.academicLevel === 'mid'
                                        ? '중'
                                        : '하'}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="px-2.5 py-1 text-center">
                                {s.engagement === 'active' ? (
                                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">적극</span>
                                ) : s.engagement === 'passive' ? (
                                  <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">소극</span>
                                ) : s.engagement === 'moderate' ? (
                                  <span className="text-[11px] text-muted-foreground">보통</span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="px-2 py-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStudent(s.id)}
                                  className="text-muted-foreground hover:text-destructive text-xs"
                                  title="삭제"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Footer Action for Step 1 */}
            <div className="mt-1 flex items-center justify-between border-t pt-2.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7.5 text-xs"
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button
                size="sm"
                className="h-7.5 gap-1.5 px-4 text-xs font-semibold shadow-2xs"
                onClick={handleProceedToCriteria}
              >
                <span>다음: 조 편성 기준 설정</span>
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </>
        )}

        {/* STEP 2: Group Formation Criteria Settings */}
        {currentStep === 'criteria' && (
          <div className="flex flex-1 flex-col space-y-3 overflow-y-auto py-1 pr-1">
            {/* Header info bar */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-primary" />
                <span className="font-semibold text-foreground">
                  대상 학급: <strong className="font-bold">{className || '학급'}</strong> ({totalStudents}명)
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-[11px] text-primary hover:bg-primary/10"
                onClick={() => setCurrentStep('roster')}
              >
                <span>← 명단 수정하기</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Card 1: Count & Size Mode + Slider */}
              <div className="space-y-2.5 rounded-xl border bg-card p-3 shadow-2xs">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                    <span className="flex size-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-black text-primary">
                      1
                    </span>
                    <span>모둠 규모 및 개수</span>
                  </div>
                  <div className="flex rounded-md bg-muted p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => onOptionsChange((prev) => ({ ...prev, groupMode: 'byCount' }))}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${options.groupMode === 'byCount'
                        ? 'bg-background font-semibold text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                      조 개수
                    </button>
                    <button
                      type="button"
                      onClick={() => onOptionsChange((prev) => ({ ...prev, groupMode: 'bySize' }))}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${options.groupMode === 'bySize'
                        ? 'bg-background font-semibold text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                      조당 인원
                    </button>
                  </div>
                </div>

                {/* Slider */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-muted-foreground">
                      {options.groupMode === 'byCount' ? '생성할 조 개수' : '조당 목표 인원'}
                    </span>
                    <span className="font-bold text-primary">
                      {options.groupMode === 'byCount'
                        ? `${options.targetGroupCount}개 조`
                        : `${options.targetGroupSize}명씩`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="6"
                    value={
                      options.groupMode === 'byCount'
                        ? options.targetGroupCount
                        : options.targetGroupSize
                    }
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      onOptionsChange((prev) =>
                        prev.groupMode === 'byCount'
                          ? { ...prev, targetGroupCount: val }
                          : { ...prev, targetGroupSize: val },
                      )
                    }}
                    className="accent-primary w-full cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>
                      {options.groupMode === 'byCount'
                        ? `조당 약 ${totalStudents > 0 ? Math.ceil(totalStudents / options.targetGroupCount) : 0}명 예상`
                        : `예상 조 개수: 약 ${totalStudents > 0 ? Math.ceil(totalStudents / options.targetGroupSize) : 0}개 조`}
                    </span>
                    <span>총 {totalStudents}명</span>
                  </div>
                </div>
              </div>

              {/* Card 2: Balance Distribution Options */}
              <div className="space-y-2.5 rounded-xl border bg-card p-3 shadow-2xs">
                <div className="flex items-center gap-1.5 border-b pb-2 text-xs font-bold text-foreground">
                  <span className="flex size-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-black text-primary">
                    2
                  </span>
                  <span>균형 분배 조건</span>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-3 items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">성별 분포</span>
                    <select
                      value={options.genderOption}
                      onChange={(e) =>
                        onOptionsChange((prev) => ({
                          ...prev,
                          genderOption: e.target.value as GroupingOptions['genderOption'],
                        }))
                      }
                      className="col-span-2 h-7.5 rounded-md border bg-background px-2 text-xs font-medium"
                    >
                      <option value="ignore">고려 안함 (무작위)</option>
                      <option value="balance">골고루 섞기 (균형)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">학업 수준</span>
                    <select
                      value={options.academicOption}
                      onChange={(e) =>
                        onOptionsChange((prev) => ({
                          ...prev,
                          academicOption: e.target.value as GroupingOptions['academicOption'],
                        }))
                      }
                      className="col-span-2 h-7.5 rounded-md border bg-background px-2 text-xs font-medium"
                    >
                      <option value="ignore">고려 안함</option>
                      <option value="hetero">골고루 섞기 (이질집단)</option>
                      <option value="homo">비슷한 수준끼리 (동질집단)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-3 items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      참여·발화 정도
                    </span>
                    <select
                      value={options.engagementOption}
                      onChange={(e) =>
                        onOptionsChange((prev) => ({
                          ...prev,
                          engagementOption: e.target.value as GroupingOptions['engagementOption'],
                        }))
                      }
                      className="col-span-2 h-7.5 rounded-md border bg-background px-2 text-xs font-medium"
                    >
                      <option value="ignore">고려 안함</option>
                      <option value="hetero">골고루 섞기 (조화)</option>
                      <option value="homo">비슷한 학생끼리</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 3: Specific Student Relationship Rules */}
            <div className="space-y-2 rounded-xl border bg-card p-3 shadow-2xs">
              <button
                type="button"
                onClick={() => setRelOpen((prev) => !prev)}
                className="flex w-full items-center justify-between text-xs font-bold text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <GitCommit className="size-3.5 text-primary" />
                  <span>특정 학생 관계 규칙 ({relationships.length}개 설정됨)</span>
                </span>
                <ChevronDown
                  className={`size-3.5 text-muted-foreground transition-transform duration-200 ${relOpen ? 'rotate-180' : ''
                    }`}
                />
              </button>

              {relOpen && (
                <div className="space-y-2 border-t pt-2 text-xs">
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-12">
                    <select
                      value={relStudentA}
                      onChange={(e) => setRelStudentA(e.target.value)}
                      className="h-7.5 rounded border bg-background px-1.5 text-xs font-medium sm:col-span-4"
                    >
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.stuNum ? `${s.stuNum}번 ` : ''}
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={relStudentB}
                      onChange={(e) => setRelStudentB(e.target.value)}
                      className="h-7.5 rounded border bg-background px-1.5 text-xs font-medium sm:col-span-4"
                    >
                      {students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.stuNum ? `${s.stuNum}번 ` : ''}
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={relType}
                      onChange={(e) => setRelType(e.target.value as RelationshipRule['type'])}
                      className="h-7.5 rounded border bg-background px-1.5 text-xs font-medium sm:col-span-3"
                    >
                      <option value="mustSeparate">분리 (필수)</option>
                      <option value="mustTogether">함께 (필수)</option>
                      <option value="preferTogether">가능하면 함께</option>
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7.5 px-3 text-xs font-semibold sm:col-span-1"
                      onClick={handleAddRelationship}
                    >
                      추가
                    </Button>
                  </div>

                  {/* Rule items list */}
                  <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
                    {relationships.length === 0 ? (
                      <p className="py-2 text-center text-[11px] text-muted-foreground">
                        설정된 관계 규칙이 없습니다.
                      </p>
                    ) : (
                      relationships.map((rule) => {
                        const sA = students.find((s) => s.id === rule.studentAId)
                        const sB = students.find((s) => s.id === rule.studentBId)
                        return (
                          <div
                            key={rule.id}
                            className="flex items-center justify-between rounded border bg-muted/30 px-2.5 py-1 text-xs"
                          >
                            <span className="font-medium text-foreground">
                              {sA?.name || '학생'} ↔ {sB?.name || '학생'}
                            </span>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[11px] font-semibold ${rule.type === 'mustSeparate'
                                  ? 'text-destructive'
                                  : 'text-primary'
                                  }`}
                              >
                                {rule.type === 'mustSeparate' ? '분리' : '함께'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveRelationship(rule.id)}
                                className="text-muted-foreground hover:text-destructive text-xs"
                                title="규칙 삭제"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Action for Step 2 */}
            <div className="mt-1 flex items-center justify-between border-t pt-2.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7.5 gap-1 text-xs"
                onClick={() => setCurrentStep('roster')}
              >
                <ArrowLeft className="size-3.5" />
                <span>이전 (명단 수정)</span>
              </Button>
              <Button
                size="sm"
                className="h-7.5 gap-1.5 px-4 text-xs font-semibold shadow-2xs"
                onClick={handleFinalExecuteGrouping}
              >
                <Sparkles className="size-3.5" />
                <span>새 조 편성 실행</span>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
