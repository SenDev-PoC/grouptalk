import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Minus,
  Plus,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MenuSelect } from "@/components/ui/menu-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  downloadSampleCsvTemplate,
  parseStudentFile,
  parseTextRoster,
} from "@/lib/excel-helper";
import { cn } from "@/lib/utils";
import type {
  AcademicLevel,
  ClassRoom,
  EngagementLevel,
  Gender,
  GroupingOptions,
  RelationshipRule,
  Student,
} from "@/types/group-formation";

const GROUP_COUNT_MAX = 20;
const GROUP_SIZE_MAX = 8;
const GROUP_VALUE_MIN = 2;

interface UnifiedClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentClass: ClassRoom | null;
  initialMode?: "create" | "edit";
  initialStep?: "roster" | "criteria";
  options: GroupingOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<GroupingOptions>>;
  relationships: RelationshipRule[];
  onSaveClass: (classData: {
    id?: string;
    name: string;
    subject?: string;
    students: Student[];
    relationships: RelationshipRule[];
  }) => Promise<void> | void;
  onExecuteGroupingAndSave: (classData: {
    id?: string;
    name: string;
    subject?: string;
    students: Student[];
    relationships: RelationshipRule[];
  }) => Promise<void> | void;
}

export function UnifiedClassDialog({
  open,
  onOpenChange,
  currentClass,
  initialMode = "edit",
  initialStep = "roster",
  options,
  onOptionsChange,
  relationships,
  onSaveClass,
  onExecuteGroupingAndSave,
}: UnifiedClassDialogProps) {
  const [currentStep, setCurrentStep] = useState<"roster" | "criteria">(
    "roster",
  );
  const [mode, setMode] = useState<"create" | "edit">("edit");

  // Form State (Roster)
  const [className, setClassName] = useState("");
  const [subject, setSubject] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [draftRelationships, setDraftRelationships] = useState<
    RelationshipRule[]
  >([]);

  // Input Methods State
  const [pasteText, setPasteText] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Direct Add Row State
  const [quickNum, setQuickNum] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickGender, setQuickGender] = useState<Gender | "">("");
  const [quickAcademic, setQuickAcademic] = useState<AcademicLevel | "">("");
  const [quickEngagement, setQuickEngagement] = useState<EngagementLevel | "">(
    "",
  );

  // Relationship Rule Form in Step 2
  const [relOpen, setRelOpen] = useState(false);
  const [relStudentA, setRelStudentA] = useState("");
  const [relStudentB, setRelStudentB] = useState("");
  const [relType, setRelType] =
    useState<RelationshipRule["type"]>("mustSeparate");
  const [stepError, setStepError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 학급을 처음 만들 때(또는 명단이 비어 있을 때)만 명단 → 편성 2단계로 진행한다. */
  const [isWizard, setIsWizard] = useState(false);

  useEffect(() => {
    if (!open) return;

    setCurrentStep(initialStep);
    setIsWizard(
      initialStep === "roster" &&
        (initialMode === "create" || !currentClass?.students.length),
    );
    setPasteText("");
    setStepError(null);
    setSaving(false);
    setRelOpen(false);
    setQuickNum("");
    setQuickName("");
    setQuickGender("");
    setQuickAcademic("");
    setQuickEngagement("");

    if (initialMode === "create") {
      setMode("create");
      setClassName("");
      setSubject("");
      setStudents([]);
      setDraftRelationships([]);
      return;
    }

    if (currentClass) {
      setMode("edit");
      const subjectFromName = currentClass.name.match(
        /^(.*?)\s*\(([^)]*)\)\s*$/,
      );
      if (currentClass.subject) {
        setClassName(
          currentClass.name.replace(/\s*\([^)]*\)\s*$/, "").trim() ||
            currentClass.name,
        );
        setSubject(currentClass.subject);
      } else if (subjectFromName) {
        setClassName(subjectFromName[1].trim());
        setSubject(subjectFromName[2].trim());
      } else {
        setClassName(currentClass.name);
        setSubject("");
      }
      setStudents([...currentClass.students]);
      const nextRels = [...(currentClass.relationships ?? relationships)];
      setDraftRelationships(nextRels);
      setRelOpen(nextRels.length > 0);
      return;
    }

    setMode("create");
    setClassName("");
    setSubject("");
    setStudents([]);
    setDraftRelationships([]);
  }, [open, initialMode, initialStep, currentClass?.id]);

  // Sync relationship selection defaults with current students
  useEffect(() => {
    if (students.length >= 2) {
      setRelStudentA((prev) =>
        students.some((s) => s.id === prev) ? prev : students[0].id,
      );
      setRelStudentB((prev) =>
        students.some((s) => s.id === prev && prev !== students[0].id)
          ? prev
          : students[1].id,
      );
    } else {
      setRelStudentA("");
      setRelStudentB("");
    }
  }, [students]);

  function buildPayload() {
    const trimmedName = className.trim();
    const trimmedSubject = subject.trim();
    return {
      id: mode === "edit" && currentClass ? currentClass.id : undefined,
      name: trimmedSubject ? `${trimmedName} (${trimmedSubject})` : trimmedName,
      subject: trimmedSubject || undefined,
      students,
      relationships: draftRelationships,
    };
  }

  function validateRoster() {
    if (!className.trim()) {
      setStepError("학년·반(학급명)을 입력해주세요.");
      return false;
    }
    if (students.length === 0) {
      setStepError("최소 1명 이상의 학생을 등록해주세요.");
      return false;
    }
    setStepError(null);
    return true;
  }

  function handleParsePasteText() {
    if (!pasteText.trim()) {
      setStepError("붙여넣을 학생 명단 텍스트를 입력해주세요.");
      return;
    }
    const parsed = parseTextRoster(pasteText);
    if (parsed.length === 0) {
      setStepError("텍스트에서 학생 이름을 찾지 못했습니다.");
      return;
    }
    setStudents((prev) => [...prev, ...parsed]);
    setPasteText("");
    setStepError(null);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const parsed = await parseStudentFile(file);
      if (parsed.length > 0) {
        setStudents((prev) => [...prev, ...parsed]);
        setStepError(null);
      } else {
        setStepError("파일에서 학생 데이터를 읽지 못했습니다.");
      }
    } catch {
      setStepError("파일을 읽는 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }

  function handleDirectAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickName.trim()) return;

    const newStudent: Student = {
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      stuNum: quickNum ? Number(quickNum) : students.length + 1,
      name: quickName.trim(),
      gender: quickGender || null,
      academicLevel: quickAcademic || null,
      engagement: quickEngagement || null,
    };

    setStudents((prev) => [...prev, newStudent]);
    setQuickName("");
    setQuickNum("");
    setQuickGender("");
    setQuickAcademic("");
    setQuickEngagement("");
    setStepError(null);
  }

  function handleDeleteStudent(id: string) {
    setStudents((prev) => prev.filter((s) => s.id !== id));
    setDraftRelationships((prev) =>
      prev.filter((rule) => rule.studentAId !== id && rule.studentBId !== id),
    );
  }

  function handleClearAllStudents() {
    if (confirm("현재 입력된 학생 명단을 모두 비우시겠습니까?")) {
      setStudents([]);
      setDraftRelationships([]);
    }
  }

  async function handleSaveRosterOnly() {
    if (!validateRoster() || saving) return;
    setSaving(true);
    try {
      await onSaveClass(buildPayload());
      onOpenChange(false);
    } catch (error) {
      setStepError(
        error instanceof Error ? error.message : "학급 저장에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleContinueToCriteria() {
    if (!validateRoster()) return;
    setCurrentStep("criteria");
  }

  function handleAddRelationship() {
    if (!relStudentA || !relStudentB) {
      setStepError("학생 명단을 먼저 선택해주세요.");
      return;
    }
    if (relStudentA === relStudentB) {
      setStepError("서로 다른 두 학생을 선택해주세요.");
      return;
    }
    const exists = draftRelationships.some(
      (r) =>
        (r.studentAId === relStudentA && r.studentBId === relStudentB) ||
        (r.studentAId === relStudentB && r.studentBId === relStudentA),
    );
    if (exists) {
      setStepError("이미 등록된 학생 관계 규칙입니다.");
      return;
    }

    const newRule: RelationshipRule = {
      id: `r_${Date.now()}`,
      studentAId: relStudentA,
      studentBId: relStudentB,
      type: relType,
    };
    setDraftRelationships((prev) => [...prev, newRule]);
    setStepError(null);
  }

  function handleRemoveRelationship(id: string) {
    setDraftRelationships((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleFinalExecuteGrouping() {
    if (!validateRoster() || saving) return;
    setSaving(true);
    try {
      await onExecuteGroupingAndSave(buildPayload());
      onOpenChange(false);
    } catch (error) {
      setStepError(
        error instanceof Error ? error.message : "모둠 편성에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  const totalStudents = students.length;
  const groupValueMax =
    options.groupMode === "byCount" ? GROUP_COUNT_MAX : GROUP_SIZE_MAX;
  const dialogTitle = isWizard
    ? "새 학급 편성"
    : currentStep === "criteria"
      ? "모둠 편성 기준"
      : mode === "create"
        ? "새 학급 추가"
        : "학급 명단 수정";
  const dialogDescription = isWizard
    ? currentStep === "roster"
      ? "학급과 명단을 입력한 뒤, 편성 조건을 정합니다."
      : "조 인원과 균형 조건을 정하면 바로 편성됩니다."
    : currentStep === "roster"
      ? mode === "create"
        ? "학급 이름과 학생 명단을 입력하고 저장하세요."
        : "학생 명단을 수정하고 저장하세요."
      : "조 인원과 균형 조건을 정하면 바로 편성됩니다.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[92vh] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none",
          currentStep === "criteria"
            ? "w-[min(96vw,44rem)]"
            : "w-[min(96vw,72rem)]",
        )}
      >
        <DialogHeader className="shrink-0 space-y-3 border-b px-6 py-5 pr-14">
          <div className="space-y-1.5">
            <DialogTitle className="text-lg">{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </div>
          {isWizard ? (
            <ol className="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center gap-1 rounded-lg p-1 text-sm font-semibold">
              <li
                className={
                  currentStep === "roster"
                    ? "bg-card text-foreground rounded-md px-3 py-1 shadow-xs"
                    : "px-3 py-1"
                }
              >
                1 명단
              </li>
              <li
                className={
                  currentStep === "criteria"
                    ? "bg-card text-foreground rounded-md px-3 py-1 shadow-xs"
                    : "px-3 py-1"
                }
              >
                2 모둠 편성
              </li>
            </ol>
          ) : null}
        </DialogHeader>

        {/* STEP 1: Roster Management */}
        {currentStep === "roster" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-4">
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
                    <Label htmlFor="class-subject-input">
                      과목 / 활동명 (선택)
                    </Label>
                    <Input
                      id="class-subject-input"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="예: 통합사회, 과학탐구"
                    />
                  </div>
                </div>

                <Card className="gap-0 py-0">
                  <CardContent className="space-y-4 px-5 py-5">
                    <h3 className="text-sm font-bold tracking-tight">
                      명단 불러오기
                    </h3>

                    <Tabs defaultValue="paste" className="w-full gap-3">
                      <TabsList className="grid h-auto w-full grid-cols-3">
                        <TabsTrigger value="paste" className="gap-1.5 py-2">
                          <FileText className="size-4" />
                          텍스트
                        </TabsTrigger>
                        <TabsTrigger value="file" className="gap-1.5 py-2">
                          <FileSpreadsheet className="size-4" />
                          엑셀
                        </TabsTrigger>
                        <TabsTrigger value="direct" className="gap-1.5 py-2">
                          <UserPlus className="size-4" />
                          직접
                        </TabsTrigger>
                      </TabsList>

                    <TabsContent value="paste" className="space-y-3 pt-3">
                      <textarea
                        rows={5}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder={
                          "예시 1: 김민준, 이지은, 박서준, 최수빈\n예시 2:\n1 김민준 남 상 적극\n2 이지은 여 중 보통\n3 박서준 남 하 소극"
                        }
                        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border p-3 font-mono text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleParsePasteText}
                        >
                          명단 추가
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="file" className="space-y-3 pt-3">
                      <div className="flex flex-col gap-3">
                        <label
                          className={`group flex w-full cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed p-4 text-sm transition ${
                            isUploading
                              ? "border-primary/60 bg-primary/10 opacity-75"
                              : "border-primary/35 bg-primary/5 hover:border-primary hover:bg-primary/10"
                          }`}
                        >
                          <div className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-lg shadow-xs">
                            <FileSpreadsheet className="size-5" />
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="font-bold">
                              {isUploading
                                ? "파일 불러오는 중…"
                                : "엑셀(Excel) 또는 CSV 파일 업로드"}
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
                        <MenuSelect
                          value={quickGender}
                          onChange={(value) =>
                            setQuickGender(value as Gender | "")
                          }
                          placeholder="성별"
                          options={[
                            { value: "", label: "성별" },
                            { value: "M", label: "남" },
                            { value: "F", label: "여" },
                          ]}
                        />
                        <MenuSelect
                          value={quickAcademic}
                          onChange={(value) =>
                            setQuickAcademic(value as AcademicLevel | "")
                          }
                          placeholder="학업"
                          options={[
                            { value: "", label: "학업" },
                            { value: "high", label: "상" },
                            { value: "mid", label: "중" },
                            { value: "low", label: "하" },
                          ]}
                        />
                        <MenuSelect
                          value={quickEngagement}
                          onChange={(value) =>
                            setQuickEngagement(value as EngagementLevel | "")
                          }
                          placeholder="참여"
                          options={[
                            { value: "", label: "참여" },
                            { value: "active", label: "적극" },
                            { value: "moderate", label: "보통" },
                            { value: "passive", label: "소극" },
                          ]}
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          className="col-span-2 sm:col-span-6"
                        >
                          <Plus className="size-4" />
                          학생 추가
                        </Button>
                      </form>
                    </TabsContent>
                  </Tabs>
                  </CardContent>
                </Card>
              </div>

              <Card className="gap-0 py-0">
                <CardContent className="space-y-3 px-5 py-5">
                <div className="flex shrink-0 items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold tracking-tight">
                      등록된 학생
                    </h3>
                    <Badge variant="secondary">{students.length}명</Badge>
                  </div>
                  {students.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={handleClearAllStudents}
                    >
                      전체 비우기
                    </Button>
                  )}
                </div>

                <div className="overflow-hidden rounded-lg border">
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
                            className="text-muted-foreground px-4 py-10 text-center text-sm"
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
                            <td className="px-3 py-2.5 font-semibold">
                              {s.name}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {s.gender === "M" ? (
                                <Badge
                                  variant="outline"
                                  className="text-blue-600"
                                >
                                  남
                                </Badge>
                              ) : s.gender === "F" ? (
                                <Badge
                                  variant="outline"
                                  className="text-pink-600"
                                >
                                  여
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {s.academicLevel ? (
                                <Badge variant="secondary">
                                  {s.academicLevel === "high"
                                    ? "상"
                                    : s.academicLevel === "mid"
                                      ? "중"
                                      : "하"}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center text-xs font-semibold">
                              {s.engagement === "active" ? (
                                <span className="text-emerald-700">적극</span>
                              ) : s.engagement === "passive" ? (
                                <span className="text-amber-700">소극</span>
                              ) : s.engagement === "moderate" ? (
                                <span className="text-muted-foreground">
                                  보통
                                </span>
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
                </CardContent>
              </Card>
              </div>
            </div>

            <DialogFooter className="bg-muted/20 mt-auto shrink-0 flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              {stepError ? (
                <p
                  className="text-destructive text-sm font-semibold"
                  role="alert"
                >
                  {stepError}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {className.trim() || "학급명 미입력"} · 학생 {students.length}
                  명
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  취소
                </Button>
                {isWizard ? (
                  <Button
                    onClick={handleContinueToCriteria}
                    disabled={!className.trim() || students.length === 0}
                  >
                    다음: 모둠 편성
                    <ArrowRight className="size-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => void handleSaveRosterOnly()}
                    disabled={
                      saving || !className.trim() || students.length === 0
                    }
                  >
                    {saving ? "저장 중…" : "저장"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </div>
        )}

        {currentStep === "criteria" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
              <Card className="gap-0 py-0">
                <CardContent className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold tracking-tight">
                      모둠 규모
                    </h3>
                    <div className="bg-muted inline-flex rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onOptionsChange((prev) => ({
                            ...prev,
                            groupMode: "byCount",
                          }))
                        }
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                          options.groupMode === "byCount"
                            ? "bg-card text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        조 개수
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onOptionsChange((prev) => ({
                            ...prev,
                            groupMode: "bySize",
                          }))
                        }
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                          options.groupMode === "bySize"
                            ? "bg-card text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        조당 인원
                      </button>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      aria-label="줄이기"
                      disabled={
                        (options.groupMode === "byCount"
                          ? options.targetGroupCount
                          : options.targetGroupSize) <= GROUP_VALUE_MIN
                      }
                      onClick={() =>
                        onOptionsChange((prev) =>
                          prev.groupMode === "byCount"
                            ? {
                                ...prev,
                                targetGroupCount: Math.max(
                                  GROUP_VALUE_MIN,
                                  prev.targetGroupCount - 1,
                                ),
                              }
                            : {
                                ...prev,
                                targetGroupSize: Math.max(
                                  GROUP_VALUE_MIN,
                                  prev.targetGroupSize - 1,
                                ),
                              },
                        )
                      }
                    >
                      <Minus className="size-4" />
                    </Button>
                    <p className="w-16 text-center text-lg font-bold tracking-tight tabular-nums">
                      {options.groupMode === "byCount"
                        ? `${options.targetGroupCount}개`
                        : `${options.targetGroupSize}명`}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      aria-label="늘리기"
                      disabled={
                        (options.groupMode === "byCount"
                          ? options.targetGroupCount
                          : options.targetGroupSize) >= groupValueMax
                      }
                      onClick={() =>
                        onOptionsChange((prev) =>
                          prev.groupMode === "byCount"
                            ? {
                                ...prev,
                                targetGroupCount: Math.min(
                                  GROUP_COUNT_MAX,
                                  prev.targetGroupCount + 1,
                                ),
                              }
                            : {
                                ...prev,
                                targetGroupSize: Math.min(
                                  GROUP_SIZE_MAX,
                                  prev.targetGroupSize + 1,
                                ),
                              },
                        )
                      }
                    >
                      <Plus className="size-4" />
                    </Button>
                    <p className="text-muted-foreground hidden text-xs sm:block">
                      {options.groupMode === "byCount"
                        ? `조당 약 ${totalStudents > 0 ? Math.ceil(totalStudents / options.targetGroupCount) : 0}명`
                        : `약 ${totalStudents > 0 ? Math.ceil(totalStudents / options.targetGroupSize) : 0}개 조`}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="space-y-3 px-4 py-4">
                  <h3 className="text-sm font-bold tracking-tight">
                    균형 분배
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="gender-option">성별</Label>
                      <MenuSelect
                        id="gender-option"
                        value={options.genderOption}
                        onChange={(value) =>
                          onOptionsChange((prev) => ({
                            ...prev,
                            genderOption:
                              value as GroupingOptions["genderOption"],
                          }))
                        }
                        options={[
                          { value: "ignore", label: "고려 안함" },
                          { value: "balance", label: "골고루 섞기" },
                        ]}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="academic-option">학업</Label>
                      <MenuSelect
                        id="academic-option"
                        value={options.academicOption}
                        onChange={(value) =>
                          onOptionsChange((prev) => ({
                            ...prev,
                            academicOption:
                              value as GroupingOptions["academicOption"],
                          }))
                        }
                        options={[
                          { value: "ignore", label: "고려 안함" },
                          { value: "hetero", label: "골고루 섞기" },
                          { value: "homo", label: "비슷한 수준끼리" },
                        ]}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="engagement-option">참여</Label>
                      <MenuSelect
                        id="engagement-option"
                        value={options.engagementOption}
                        onChange={(value) =>
                          onOptionsChange((prev) => ({
                            ...prev,
                            engagementOption:
                              value as GroupingOptions["engagementOption"],
                          }))
                        }
                        options={[
                          { value: "ignore", label: "고려 안함" },
                          { value: "hetero", label: "골고루 섞기" },
                          { value: "homo", label: "비슷한 학생끼리" },
                        ]}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="gap-0 py-0">
                <CardContent className="px-4 py-4">
                  <button
                    type="button"
                    onClick={() => setRelOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <h3 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                      특정 학생 관계
                      <Badge variant="secondary">
                        {draftRelationships.length}개
                      </Badge>
                    </h3>
                    <ChevronDown
                      className={`text-muted-foreground size-4 transition-transform ${
                        relOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {relOpen ? (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                        <MenuSelect
                          value={relStudentA}
                          onChange={setRelStudentA}
                          placeholder="학생 A"
                          options={students.map((s) => ({
                            value: s.id,
                            label: `${s.stuNum ? `${s.stuNum}번 ` : ""}${s.name}`,
                          }))}
                        />
                        <MenuSelect
                          value={relStudentB}
                          onChange={setRelStudentB}
                          placeholder="학생 B"
                          options={students.map((s) => ({
                            value: s.id,
                            label: `${s.stuNum ? `${s.stuNum}번 ` : ""}${s.name}`,
                          }))}
                        />
                        <MenuSelect
                          value={relType}
                          onChange={(value) =>
                            setRelType(value as RelationshipRule["type"])
                          }
                          options={[
                            { value: "mustSeparate", label: "분리" },
                            { value: "mustTogether", label: "함께" },
                            { value: "preferTogether", label: "가능하면 함께" },
                          ]}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAddRelationship}
                        >
                          <Plus className="size-4" />
                          추가
                        </Button>
                      </div>

                      {draftRelationships.length === 0 ? (
                        <p className="text-muted-foreground py-2 text-sm">
                          규칙을 추가하면 편성에 반영됩니다.
                        </p>
                      ) : (
                        <div className="max-h-36 space-y-1.5 overflow-y-auto">
                          {draftRelationships.map((rule) => {
                            const sA = students.find(
                              (s) => s.id === rule.studentAId,
                            );
                            const sB = students.find(
                              (s) => s.id === rule.studentBId,
                            );
                            return (
                              <div
                                key={rule.id}
                                className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                              >
                                <p className="text-sm font-semibold">
                                  {sA?.name || "학생"} ↔ {sB?.name || "학생"}
                                </p>
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`text-xs font-bold ${
                                      rule.type === "mustSeparate"
                                        ? "text-destructive"
                                        : "text-primary"
                                    }`}
                                  >
                                    {rule.type === "mustSeparate"
                                      ? "분리"
                                      : rule.type === "mustTogether"
                                        ? "함께"
                                        : "가능하면 함께"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRemoveRelationship(rule.id)
                                    }
                                    className="text-muted-foreground hover:text-destructive text-sm"
                                    title="규칙 삭제"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <DialogFooter className="bg-muted/20 mt-auto shrink-0 flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              {stepError ? (
                <p
                  className="text-destructive text-sm font-semibold"
                  role="alert"
                >
                  {stepError}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {options.groupMode === "byCount"
                    ? `${options.targetGroupCount}개 조로 나눕니다`
                    : `조당 ${options.targetGroupSize}명으로 나눕니다`}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                {isWizard ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStepError(null);
                      setCurrentStep("roster");
                    }}
                    disabled={saving}
                  >
                    <ArrowLeft className="size-4" />
                    이전
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={saving}
                  >
                    취소
                  </Button>
                )}
                <Button
                  onClick={() => void handleFinalExecuteGrouping()}
                  disabled={saving || totalStudents === 0}
                >
                  <Sparkles className="size-4" />
                  {saving ? "편성 중…" : "편성하기"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
