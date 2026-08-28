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
  UserPlus,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'

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
  currentClass: ClassRoom | null
  initialMode?: 'create' | 'edit'
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
}

export function UnifiedClassDialog({
  open,
  onOpenChange,
  currentClass,
  initialMode = 'edit',
  initialStep = 'roster',
  options,
  onOptionsChange,
  relationships,
  onSetRelationships,
  onExecuteGroupingAndSave,
}: UnifiedClassDialogProps) {
  const [currentStep, setCurrentStep] = useState<'roster' | 'criteria'>('roster')
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
  const [relOpen, setRelOpen] = useState(true)
  const [relStudentA, setRelStudentA] = useState('')
  const [relStudentB, setRelStudentB] = useState('')
  const [relType, setRelType] = useState<RelationshipRule['type']>('mustSeparate')
  const [stepError, setStepError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCurrentStep(initialStep)
      if (initialMode === 'create' || !currentClass) {
        setMode('create')
        setClassName('')
        setSubject('')
        setStudents([])
      } else {
        setMode('edit')
        setClassName(currentClass.name.split(' (')[0] || currentClass.name)
        setSubject(currentClass.subject || '')
        setStudents([...currentClass.students])
      }
      setPasteText('')
      setStepError(null)
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

  function handleParsePasteText() {
    if (!pasteText.trim()) {
      setStepError('붙여넣을 학생 명단 텍스트를 입력해주세요.')
      return
    }
    const parsed = parseTextRoster(pasteText)
    if (parsed.length === 0) {
      setStepError('텍스트에서 학생 이름을 찾지 못했습니다.')
      return
    }
    setStudents((prev) => [...prev, ...parsed])
    setPasteText('')
    setStepError(null)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      const parsed = await parseStudentFile(file)
      if (parsed.length > 0) {
        setStudents((prev) => [...prev, ...parsed])
        setStepError(null)
      } else {
        setStepError('파일에서 학생 데이터를 읽지 못했습니다.')
      }
    } catch {
      setStepError('파일을 읽는 중 오류가 발생했습니다.')
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }

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
    setStepError(null)
  }

  function handleDeleteStudent(id: string) {
    setStudents((prev) => prev.filter((s) => s.id !== id))
  }

  function handleClearAllStudents() {
    if (confirm('현재 입력된 학생 명단을 모두 비우시겠습니까?')) {
      setStudents([])
    }
  }

  function handleProceedToCriteria() {
    if (!className.trim()) {
      setStepError('학년·반(학급명)을 입력해주세요.')
      return
    }
    if (students.length === 0) {
      setStepError('최소 1명 이상의 학생을 등록해주세요.')
      return
    }
    setStepError(null)
    setCurrentStep('criteria')
  }

  function handleAddRelationship() {
    if (!relStudentA || !relStudentB) {
      setStepError('학생 명단을 먼저 선택해주세요.')
      return
    }
    if (relStudentA === relStudentB) {
      setStepError('서로 다른 두 학생을 선택해주세요.')
      return
    }
    const exists = relationships.some(
      (r) =>
        (r.studentAId === relStudentA && r.studentBId === relStudentB) ||
        (r.studentAId === relStudentB && r.studentBId === relStudentA),
    )
    if (exists) {
      setStepError('이미 등록된 학생 관계 규칙입니다.')
      return
    }

    const newRule: RelationshipRule = {
      id: `r_${Date.now()}`,
      studentAId: relStudentA,
      studentBId: relStudentB,
      type: relType,
    }
    onSetRelationships((prev) => [...prev, newRule])
    setStepError(null)
  }

  function handleRemoveRelationship(id: string) {
    onSetRelationships((prev) => prev.filter((r) => r.id !== id))
  }

  function handleFinalExecuteGrouping() {
    if (!className.trim()) {
      setStepError('학년·반(학급명)을 입력해주세요.')
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
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,72rem)] max-w-none flex-col gap-5 overflow-hidden p-6 sm:max-w-none">
        <DialogHeader className="shrink-0 space-y-3 border-b pb-4 pr-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2.5">
              <FolderCog className="text-primary size-5" />
              학급 및 모둠 편성
            </DialogTitle>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentStep('roster')}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                  currentStep === 'roster'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-background/20 text-xs">
                  1
                </span>
                학급·명단 관리
              </button>

              <span className="text-muted-foreground text-sm">→</span>

              <button
                type="button"
                onClick={handleProceedToCriteria}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                  currentStep === 'criteria'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-background/20 text-xs">
                  2
                </span>
                모둠 편성 기준 설정
              </button>
            </div>
          </div>
          <DialogDescription>
            {currentStep === 'roster'
              ? '학급 정보와 학생 명단을 등록하고 [다음]을 눌러 모둠 편성 기준을 설정하세요.'
              : '인원수, 성별, 학업 수준, 발화도 및 학생 간 관계 규칙을 설정한 후 모둠 편성을 실행합니다.'}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: Roster Management */}
        {currentStep === 'roster' && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <p className="shrink-0 text-sm font-bold">
              {mode === 'create' ? '새 학급 등록' : `${className || '학급'} 명단 관리`}
            </p>

            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:overflow-hidden">
                <div className="space-y-4 lg:overflow-y-auto lg:pr-1">
                  <div className="bg-muted/30 space-y-3 rounded-xl border p-4">
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs">
                        1
                      </span>
                      학급 기본 정보
                    </p>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="class-name-input">학년·반 (필수)</Label>
                        <Input
                          id="class-name-input"
                          value={className}
                          onChange={(e) => setClassName(e.target.value)}
                          placeholder="예: 1학년 3반, 2-1반"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="class-subject-input">과목 / 활동명 (선택)</Label>
                        <Input
                          id="class-subject-input"
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          placeholder="예: 통합사회, 과학탐구, 진로활동"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-card space-y-4 rounded-xl border p-4 shadow-xs">
                    <div className="flex items-center justify-between gap-3 border-b pb-3">
                      <p className="flex items-center gap-2 text-sm font-bold">
                        <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs">
                          2
                        </span>
                        학생 명단 등록
                      </p>
                      <Badge variant="outline">등록 {students.length}명</Badge>
                    </div>

                    <Tabs defaultValue="paste" className="w-full">
                      <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl p-1">
                        <TabsTrigger value="paste" className="gap-1.5 py-2.5 text-sm">
                          <FileText className="size-4" />
                          텍스트
                        </TabsTrigger>
                        <TabsTrigger value="file" className="gap-1.5 py-2.5 text-sm">
                          <FileSpreadsheet className="size-4" />
                          엑셀
                        </TabsTrigger>
                        <TabsTrigger value="direct" className="gap-1.5 py-2.5 text-sm">
                          <UserPlus className="size-4" />
                          직접 추가
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="paste" className="space-y-3 pt-3">
                        <p className="text-muted-foreground text-sm leading-relaxed">
                          나이스(NEIS)나 한글/메모장 명단을 붙여넣으세요. 이름만 나열하거나{' '}
                          <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                            1 김민준 남 상 적극
                          </code>{' '}
                          형식도 인식합니다.
                        </p>
                        <textarea
                          rows={8}
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                          placeholder={
                            '예시 1: 김민준, 이지은, 박서준, 최수빈\n예시 2:\n1 김민준 남 상 적극\n2 이지은 여 중 보통\n3 박서준 남 하 소극'
                          }
                          className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border p-3 font-mono text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                        />
                        <div className="flex justify-end">
                          <Button type="button" onClick={handleParsePasteText}>
                            <Sparkles className="size-4" />
                            텍스트 명단 추가
                          </Button>
                        </div>
                      </TabsContent>

                      <TabsContent value="file" className="space-y-3 pt-3">
                        <div className="flex flex-col gap-3">
                          <label
                            className={`group flex w-full cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed p-4 text-sm transition ${
                              isUploading
                                ? 'border-primary/60 bg-primary/10 opacity-75'
                                : 'border-primary/35 bg-primary/5 hover:border-primary hover:bg-primary/10'
                            }`}
                          >
                            <div className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-lg shadow-xs">
                              <FileSpreadsheet className="size-5" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="font-bold">
                                {isUploading
                                  ? '파일 불러오는 중…'
                                  : '엑셀(Excel) 또는 CSV 파일 업로드'}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                .xlsx, .xls, .csv 지원 · 클릭하여 파일 선택
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

                          <Button
                            type="button"
                            variant="outline"
                            onClick={downloadSampleCsvTemplate}
                            title="성별/학업수준/발화정도 드롭다운이 적용된 엑셀 양식 다운로드"
                          >
                            <Download className="size-4" />
                            엑셀 양식 다운로드 (.xlsx)
                          </Button>
                        </div>
                      </TabsContent>

                      <TabsContent value="direct" className="space-y-3 pt-3">
                        <p className="text-muted-foreground text-sm">
                          번호·이름·속성으로 학생을 1명씩 등록합니다.
                        </p>
                        <form
                          onSubmit={handleDirectAdd}
                          className="grid grid-cols-2 gap-2 sm:grid-cols-6"
                        >
                          <Input
                            placeholder="번호"
                            value={quickNum}
                            onChange={(e) => setQuickNum(e.target.value)}
                            className="sm:col-span-1"
                            type="number"
                          />
                          <Input
                            placeholder="이름 (필수)"
                            value={quickName}
                            onChange={(e) => setQuickName(e.target.value)}
                            className="col-span-2 sm:col-span-2"
                            required
                          />
                          <select
                            value={quickGender}
                            onChange={(e) => setQuickGender(e.target.value as Gender | '')}
                            className="border-input bg-card h-11 rounded-md border px-3 text-sm shadow-xs"
                          >
                            <option value="">성별</option>
                            <option value="M">남</option>
                            <option value="F">여</option>
                          </select>
                          <select
                            value={quickAcademic}
                            onChange={(e) =>
                              setQuickAcademic(e.target.value as AcademicLevel | '')
                            }
                            className="border-input bg-card h-11 rounded-md border px-3 text-sm shadow-xs"
                          >
                            <option value="">학업</option>
                            <option value="high">상</option>
                            <option value="mid">중</option>
                            <option value="low">하</option>
                          </select>
                          <select
                            value={quickEngagement}
                            onChange={(e) =>
                              setQuickEngagement(e.target.value as EngagementLevel | '')
                            }
                            className="border-input bg-card h-11 rounded-md border px-3 text-sm shadow-xs"
                          >
                            <option value="">참여</option>
                            <option value="active">적극</option>
                            <option value="moderate">보통</option>
                            <option value="passive">소극</option>
                          </select>
                          <Button type="submit" className="col-span-2 sm:col-span-6">
                            <Plus className="size-4" />
                            학생 추가
                          </Button>
                        </form>
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>

                <div className="bg-card flex min-h-0 flex-col gap-3 rounded-xl border p-4 shadow-xs lg:overflow-hidden">
                  <div className="flex shrink-0 items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <span className="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full text-xs">
                        3
                      </span>
                      등록된 학생 명단
                      <span className="text-muted-foreground font-normal">({students.length}명)</span>
                    </p>
                    {students.length > 0 && (
                      <Button
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={handleClearAllStudents}
                      >
                        명단 전체 비우기
                      </Button>
                    )}
                  </div>

                  <div className="min-h-[18rem] flex-1 overflow-y-auto rounded-lg border lg:min-h-0">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/80 text-muted-foreground sticky top-0 border-b font-semibold">
                        <tr>
                          <th className="w-14 px-3 py-2.5 text-center">번호</th>
                          <th className="px-3 py-2.5">학생명</th>
                          <th className="px-3 py-2.5 text-center">성별</th>
                          <th className="px-3 py-2.5 text-center">학업</th>
                          <th className="px-3 py-2.5 text-center">참여</th>
                          <th className="w-12 px-2 py-2.5 text-center">삭제</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {students.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="text-muted-foreground px-4 py-16 text-center text-sm"
                            >
                              아직 등록된 학생이 없습니다.
                              <br />
                              왼쪽에서 텍스트·파일·직접 추가로 명단을 넣어주세요.
                            </td>
                          </tr>
                        ) : (
                          students.map((s, idx) => (
                            <tr key={s.id} className="hover:bg-muted/30">
                              <td className="text-muted-foreground tabular px-3 py-2.5 text-center text-xs">
                                {s.stuNum ?? idx + 1}
                              </td>
                              <td className="px-3 py-2.5 font-semibold">{s.name}</td>
                              <td className="px-3 py-2.5 text-center">
                                {s.gender === 'M' ? (
                                  <Badge variant="outline" className="text-blue-600">
                                    남
                                  </Badge>
                                ) : s.gender === 'F' ? (
                                  <Badge variant="outline" className="text-pink-600">
                                    여
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {s.academicLevel ? (
                                  <Badge variant="secondary">
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
                              <td className="px-3 py-2.5 text-center text-xs font-semibold">
                                {s.engagement === 'active' ? (
                                  <span className="text-emerald-700">적극</span>
                                ) : s.engagement === 'passive' ? (
                                  <span className="text-amber-700">소극</span>
                                ) : s.engagement === 'moderate' ? (
                                  <span className="text-muted-foreground">보통</span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStudent(s.id)}
                                  className="text-muted-foreground hover:text-destructive text-sm"
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

            {stepError && currentStep === 'roster' ? (
              <p className="text-destructive shrink-0 text-sm font-semibold">{stepError}</p>
            ) : null}

            <div className="mt-auto flex shrink-0 items-center justify-between border-t pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button onClick={handleProceedToCriteria}>
                다음: 모둠 편성 기준 설정
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'criteria' && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="bg-muted/30 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Users className="text-primary size-4" />
                <p className="text-sm font-semibold">
                  대상 학급: <span className="font-bold">{className || '학급'}</span>
                  <span className="text-muted-foreground font-normal"> · {totalStudents}명</span>
                </p>
              </div>
              <Button variant="ghost" onClick={() => setCurrentStep('roster')}>
                <ArrowLeft className="size-4" />
                명단 수정
              </Button>
            </div>

            {stepError ? (
              <p className="text-destructive shrink-0 text-sm font-semibold">{stepError}</p>
            ) : null}

            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-2">
              <div className="bg-card space-y-4 rounded-xl border p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span className="bg-primary/10 text-primary flex size-5 items-center justify-center rounded-full text-xs font-bold">
                      1
                    </span>
                    모둠 규모
                  </p>
                  <div className="bg-muted flex rounded-lg p-1">
                    <button
                      type="button"
                      onClick={() => onOptionsChange((prev) => ({ ...prev, groupMode: 'byCount' }))}
                      className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                        options.groupMode === 'byCount'
                          ? 'bg-card text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      조 개수
                    </button>
                    <button
                      type="button"
                      onClick={() => onOptionsChange((prev) => ({ ...prev, groupMode: 'bySize' }))}
                      className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                        options.groupMode === 'bySize'
                          ? 'bg-card text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      조당 인원
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-muted-foreground text-sm">
                        {options.groupMode === 'byCount' ? '생성할 조 개수' : '조당 목표 인원'}
                      </p>
                      <p className="text-primary mt-1 text-2xl font-bold tracking-tight">
                        {options.groupMode === 'byCount'
                          ? `${options.targetGroupCount}개`
                          : `${options.targetGroupSize}명`}
                      </p>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {options.groupMode === 'byCount'
                        ? `조당 약 ${totalStudents > 0 ? Math.ceil(totalStudents / options.targetGroupCount) : 0}명`
                        : `약 ${totalStudents > 0 ? Math.ceil(totalStudents / options.targetGroupSize) : 0}개 조`}
                    </p>
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
                </div>
              </div>

              <div className="bg-card space-y-4 rounded-xl border p-4 shadow-xs">
                <p className="flex items-center gap-2 border-b pb-3 text-sm font-bold">
                  <span className="bg-primary/10 text-primary flex size-5 items-center justify-center rounded-full text-xs font-bold">
                    2
                  </span>
                  균형 분배 조건
                </p>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="gender-option">성별 분포</Label>
                    <select
                      id="gender-option"
                      value={options.genderOption}
                      onChange={(e) =>
                        onOptionsChange((prev) => ({
                          ...prev,
                          genderOption: e.target.value as GroupingOptions['genderOption'],
                        }))
                      }
                      className="border-input bg-card h-11 w-full rounded-md border px-3.5 text-sm shadow-xs"
                    >
                      <option value="ignore">고려 안함 (무작위)</option>
                      <option value="balance">골고루 섞기 (균형)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="academic-option">학업 수준</Label>
                    <select
                      id="academic-option"
                      value={options.academicOption}
                      onChange={(e) =>
                        onOptionsChange((prev) => ({
                          ...prev,
                          academicOption: e.target.value as GroupingOptions['academicOption'],
                        }))
                      }
                      className="border-input bg-card h-11 w-full rounded-md border px-3.5 text-sm shadow-xs"
                    >
                      <option value="ignore">고려 안함</option>
                      <option value="hetero">골고루 섞기 (이질집단)</option>
                      <option value="homo">비슷한 수준끼리 (동질집단)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="engagement-option">참여·발화 정도</Label>
                    <select
                      id="engagement-option"
                      value={options.engagementOption}
                      onChange={(e) =>
                        onOptionsChange((prev) => ({
                          ...prev,
                          engagementOption: e.target.value as GroupingOptions['engagementOption'],
                        }))
                      }
                      className="border-input bg-card h-11 w-full rounded-md border px-3.5 text-sm shadow-xs"
                    >
                      <option value="ignore">고려 안함</option>
                      <option value="hetero">골고루 섞기 (조화)</option>
                      <option value="homo">비슷한 학생끼리</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-card space-y-4 rounded-xl border p-4 shadow-xs lg:col-span-2">
                <button
                  type="button"
                  onClick={() => setRelOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <GitCommit className="text-primary size-4" />
                    특정 학생 관계 규칙
                    <Badge variant="secondary">{relationships.length}개</Badge>
                  </p>
                  <ChevronDown
                    className={`text-muted-foreground size-4 transition-transform ${
                      relOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {relOpen ? (
                  <div className="space-y-3 border-t pt-4">
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <select
                        value={relStudentA}
                        onChange={(e) => setRelStudentA(e.target.value)}
                        className="border-input bg-card h-11 rounded-md border px-3 text-sm shadow-xs"
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
                        className="border-input bg-card h-11 rounded-md border px-3 text-sm shadow-xs"
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
                        className="border-input bg-card h-11 rounded-md border px-3 text-sm shadow-xs"
                      >
                        <option value="mustSeparate">분리 (필수)</option>
                        <option value="mustTogether">함께 (필수)</option>
                        <option value="preferTogether">가능하면 함께</option>
                      </select>
                      <Button type="button" onClick={handleAddRelationship}>
                        <Plus className="size-4" />
                        추가
                      </Button>
                    </div>

                    <div className="max-h-40 space-y-2 overflow-y-auto">
                      {relationships.length === 0 ? (
                        <p className="text-muted-foreground py-6 text-center text-sm">
                          설정된 관계 규칙이 없습니다.
                        </p>
                      ) : (
                        relationships.map((rule) => {
                          const sA = students.find((s) => s.id === rule.studentAId)
                          const sB = students.find((s) => s.id === rule.studentBId)
                          return (
                            <div
                              key={rule.id}
                              className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5"
                            >
                              <p className="text-sm font-semibold">
                                {sA?.name || '학생'} ↔ {sB?.name || '학생'}
                              </p>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs font-bold ${
                                    rule.type === 'mustSeparate'
                                      ? 'text-destructive'
                                      : 'text-primary'
                                  }`}
                                >
                                  {rule.type === 'mustSeparate'
                                    ? '분리'
                                    : rule.type === 'mustTogether'
                                      ? '함께'
                                      : '가능하면 함께'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRelationship(rule.id)}
                                  className="text-muted-foreground hover:text-destructive text-sm"
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
                ) : null}
              </div>
            </div>

            <div className="mt-auto flex shrink-0 items-center justify-between border-t pt-4">
              <Button variant="outline" onClick={() => setCurrentStep('roster')}>
                <ArrowLeft className="size-4" />
                이전 (명단 수정)
              </Button>
              <Button onClick={handleFinalExecuteGrouping}>
                <Sparkles className="size-4" />
                새 모둠 편성 실행
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
