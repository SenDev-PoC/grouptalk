import { Pencil, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { GROUP_CARD_GRID } from "@/components/common/group-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { data } from "@/data";
import { executeGrouping } from "@/lib/group-formation";
import { cn } from "@/lib/utils";
import type {
  ClassRoom,
  FormedGroup,
  GroupingOptions,
  RelationshipRule,
  Student,
} from "@/types/group-formation";

import { UnifiedClassDialog } from "./unified-class-dialog";

export function GroupFormationView({ teacherId }: { teacherId: string }) {
  const [classes, setClasses] = useState<ClassRoom[] | null>(null);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [loading, setLoading] = useState(true);

  const [options, setOptions] = useState<GroupingOptions>({
    groupMode: "byCount",
    targetGroupCount: 3,
    targetGroupSize: 4,
    genderOption: "balance",
    academicOption: "hetero",
    engagementOption: "hetero",
  });

  const [relationships, setRelationships] = useState<RelationshipRule[]>([]);
  const [draftGroups, setDraftGroups] = useState<FormedGroup[]>([]);

  const [draggedStudentId, setDraggedStudentId] = useState<string | null>(null);
  const [sourceGroupId, setSourceGroupId] = useState<number | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);

  const [unifiedDialogOpen, setUnifiedDialogOpen] = useState(false);
  const [unifiedDialogMode, setUnifiedDialogMode] = useState<"create" | "edit">(
    "edit",
  );
  const [unifiedDialogStep, setUnifiedDialogStep] = useState<
    "roster" | "criteria"
  >("roster");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClassRoom | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refreshClasses = useCallback(async () => {
    const list = await data().listClasses(teacherId);
    setClasses(list);
    setSelectedClassId((prev) => {
      if (prev && list.some((item) => item.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
    return list;
  }, [teacherId]);

  useEffect(() => {
    setLoading(true);
    void refreshClasses()
      .catch(() => setClasses([]))
      .finally(() => setLoading(false));
  }, [refreshClasses]);

  const currentClass = useMemo(() => {
    if (!classes || classes.length === 0) return null;
    return classes.find((c) => c.id === selectedClassId) || classes[0] || null;
  }, [classes, selectedClassId]);

  useEffect(() => {
    setRelationships(currentClass?.relationships ?? []);
  }, [currentClass?.id]);

  const persistGroups = useCallback(
    async (classId: string, groups: FormedGroup[]) => {
      setSaveError(null);
      try {
        const updated = await data().confirmClassGroups({
          teacherId,
          classId,
          groups,
        });
        setClasses((prev) =>
          prev
            ? prev.map((item) => (item.id === updated.id ? updated : item))
            : [updated],
        );
        setDraftGroups(updated.activeGroups ?? groups);
      } catch (error) {
        setSaveError(
          error instanceof Error
            ? error.message
            : "모둠 저장에 실패했습니다. 다시 시도해 주세요.",
        );
      }
    },
    [teacherId],
  );

  const handleExecuteGrouping = useCallback(() => {
    if (!currentClass || currentClass.students.length === 0) {
      setDraftGroups([]);
      return;
    }
    const result = executeGrouping(
      currentClass.students,
      options,
      relationships,
    );
    setDraftGroups(result);
    void persistGroups(currentClass.id, result);
  }, [currentClass, options, relationships, persistGroups]);

  useEffect(() => {
    if (!currentClass) {
      setDraftGroups([]);
      return;
    }
    if (currentClass.activeGroups) {
      setDraftGroups(currentClass.activeGroups);
    } else {
      setDraftGroups([]);
    }
  }, [currentClass?.id]);

  async function handleDeleteClass() {
    if (!deleteTarget) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await data().deleteClass(deleteTarget.id);
      setDeleteTarget(null);
      await refreshClasses();
      setDraftGroups([]);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "학급 삭제에 실패했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setDeleting(false);
    }
  }

  function handleOpenCreateClass() {
    setUnifiedDialogMode("create");
    setUnifiedDialogStep("roster");
    setUnifiedDialogOpen(true);
  }

  function handleOpenEditClass() {
    if (!currentClass) {
      handleOpenCreateClass();
      return;
    }
    setUnifiedDialogMode("edit");
    setUnifiedDialogStep("roster");
    setUnifiedDialogOpen(true);
  }

  function handleOpenCriteriaModal() {
    if (!currentClass) {
      handleOpenCreateClass();
      return;
    }
    setUnifiedDialogMode("edit");
    setUnifiedDialogStep("criteria");
    setUnifiedDialogOpen(true);
  }

  /** 학급 상태에 따라 다음에 해야 할 일 하나만 실행한다. */
  function handlePrimaryAction() {
    if (!currentClass) {
      handleOpenCreateClass();
      return;
    }
    if (currentClass.students.length === 0) {
      handleOpenEditClass();
      return;
    }
    handleOpenCriteriaModal();
  }

  async function handleSaveClassAndStudents(payload: {
    id?: string;
    name: string;
    subject?: string;
    students: Student[];
    relationships: RelationshipRule[];
  }) {
    const saved = await data().upsertClass({
      teacherId,
      id: payload.id,
      name: payload.name,
      subject: payload.subject,
      students: payload.students,
      relationships: payload.relationships.map((rule) => ({
        studentAId: rule.studentAId,
        studentBId: rule.studentBId,
        type: rule.type,
      })),
    });
    await refreshClasses();
    setSelectedClassId(saved.id);
    setRelationships(saved.relationships ?? []);
    if (saved.students.length === 0) {
      setDraftGroups([]);
      await persistGroups(saved.id, []);
      return;
    }
    const result = executeGrouping(
      saved.students,
      options,
      saved.relationships ?? [],
    );
    setDraftGroups(result);
    await persistGroups(saved.id, result);
  }

  async function handleExecuteGroupingAndSave(payload: {
    id?: string;
    name: string;
    subject?: string;
    students: Student[];
    relationships: RelationshipRule[];
  }) {
    const saved = await data().upsertClass({
      teacherId,
      id: payload.id,
      name: payload.name,
      subject: payload.subject,
      students: payload.students,
      relationships: payload.relationships.map((rule) => ({
        studentAId: rule.studentAId,
        studentBId: rule.studentBId,
        type: rule.type,
      })),
    });
    await refreshClasses();
    setSelectedClassId(saved.id);
    setRelationships(saved.relationships ?? []);
    const result = executeGrouping(
      saved.students,
      options,
      saved.relationships ?? [],
    );
    setDraftGroups(result);
    await persistGroups(saved.id, result);
  }

  function handleDrop(targetGroupId: number) {
    if (
      !draggedStudentId ||
      sourceGroupId === null ||
      sourceGroupId === targetGroupId
    ) {
      setDraggedStudentId(null);
      setSourceGroupId(null);
      setDragOverGroupId(null);
      return;
    }

    const targetStudent = currentClass?.students.find(
      (s) => s.id === draggedStudentId,
    );
    if (!currentClass || !targetStudent) return;

    const next = draftGroups.map((g) => {
      if (g.groupId === sourceGroupId) {
        return {
          ...g,
          members: g.members.filter((m) => m.id !== draggedStudentId),
        };
      }
      if (g.groupId === targetGroupId) {
        return { ...g, members: [...g.members, targetStudent] };
      }
      return g;
    });

    setDraftGroups(next);
    setDraggedStudentId(null);
    setSourceGroupId(null);
    setDragOverGroupId(null);
    void persistGroups(currentClass.id, next);
  }

  const totalStudents = currentClass?.students.length || 0;
  const needsRoster = Boolean(currentClass) && totalStudents === 0;
  const hasGroups = draftGroups.length > 0;

  if (loading || classes === null) {
    return (
      <div className="text-muted-foreground flex min-h-40 items-center justify-center text-sm">
        학급 정보를 불러오는 중…
      </div>
    );
  }

  return (
    <div className="flex items-start gap-5">
      <aside
        className="bg-card sticky top-[5.5rem] z-20 flex max-h-[min(70vh,36rem)] w-40 shrink-0 flex-col gap-1 overflow-y-auto rounded-xl border p-1.5"
        aria-label="학급 목록"
      >
        {(classes ?? []).map((classroom) => {
          const selected = classroom.id === currentClass?.id;
          const label =
            classroom.name.replace(/\s*\([^)]*\)\s*$/, "").trim() ||
            classroom.name;
          return (
            <button
              key={classroom.id}
              type="button"
              onClick={() => setSelectedClassId(classroom.id)}
              title={`${classroom.name} · ${classroom.students.length}명`}
              aria-pressed={selected}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
                selected
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-bold">
                {label}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] font-semibold",
                  selected
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground",
                )}
              >
                {classroom.students.length}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={handleOpenCreateClass}
          title="학급 추가"
          className="text-muted-foreground hover:text-foreground mt-0.5 flex w-full shrink-0 items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-muted/60"
        >
          <Plus className="size-4 shrink-0" />
          학급 추가
        </button>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-xl leading-snug font-bold tracking-tight">
              {currentClass ? currentClass.name : "모둠 편성"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {currentClass
                ? hasGroups
                  ? `${totalStudents}명 · ${draftGroups.length}개 조`
                  : `학생 ${totalStudents}명`
                : "왼쪽에서 학급을 선택하거나 추가하세요"}
            </p>
          </div>

          {currentClass ? (
            <div className="flex flex-wrap items-center gap-2">
              {hasGroups ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenEditClass}
                  >
                    <Pencil className="size-4" />
                    명단
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleExecuteGrouping}
                  >
                    <RotateCcw className="size-4" />
                    다시 섞기
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenCriteriaModal}
                  >
                    <Sparkles className="size-4" />
                    조건
                  </Button>
                </>
              ) : needsRoster ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenEditClass}
                >
                  <Pencil className="size-4" />
                  명단 수정
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteTarget(currentClass)}
                aria-label={`${currentClass.name} 학급 삭제`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ) : null}
        </header>

        {saveError ? (
          <p className="text-destructive text-sm" role="alert">
            {saveError}
          </p>
        ) : null}

        {draftGroups.length === 0 ? (
          <EmptyState
            title={
              !currentClass
                ? "학급을 먼저 추가해 주세요"
                : needsRoster
                  ? "학생 명단이 비어 있습니다"
                  : "아직 편성된 모둠이 없습니다"
            }
            action={
              currentClass ? (
                <Button onClick={handlePrimaryAction}>
                  {needsRoster ? (
                    <>
                      <Plus className="size-4" />
                      명단 입력
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      모둠 편성
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={handleOpenCreateClass}>
                  <Plus className="size-4" />
                  학급 추가
                </Button>
              )
            }
          />
        ) : (
          <div className={GROUP_CARD_GRID}>
              {draftGroups.map((group) => {
                const members = group.members;
                const mCount = members.filter((m) => m.gender === "M").length;
                const fCount = members.filter((m) => m.gender === "F").length;
                const highCount = members.filter(
                  (m) => m.academicLevel === "high",
                ).length;
                const midCount = members.filter(
                  (m) => m.academicLevel === "mid",
                ).length;
                const lowCount = members.filter(
                  (m) => m.academicLevel === "low",
                ).length;
                const activeCount = members.filter(
                  (m) => m.engagement === "active",
                ).length;
                const moderateCount = members.filter(
                  (m) => m.engagement === "moderate",
                ).length;
                const passiveCount = members.filter(
                  (m) => m.engagement === "passive",
                ).length;

                const isDropTarget = dragOverGroupId === group.groupId;

                return (
                  <Card
                    key={group.groupId}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverGroupId(group.groupId);
                    }}
                    onDragLeave={() => {
                      if (dragOverGroupId === group.groupId) {
                        setDragOverGroupId(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(group.groupId);
                    }}
                    className={cn(
                      "h-full gap-0 py-0 transition-colors",
                      isDropTarget && "border-primary bg-primary/5",
                    )}
                  >
                    <CardContent className="flex h-full flex-col gap-3 px-5 py-5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="truncate font-bold">{group.groupName}</p>
                        <Badge variant="secondary">{members.length}명</Badge>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="font-normal">
                          남{mCount} · 여{fCount}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          상{highCount} · 중{midCount} · 하{lowCount}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          적극{activeCount} · 보통{moderateCount} · 소극
                          {passiveCount}
                        </Badge>
                      </div>

                      <div className="flex flex-1 flex-col gap-1.5">
                        {members.length === 0 ? (
                          <div className="text-muted-foreground flex min-h-20 flex-1 items-center justify-center rounded-lg border border-dashed text-sm">
                            학생을 드래그하세요
                          </div>
                        ) : (
                          members.map((s) => {
                            const isBeingDragged = draggedStudentId === s.id;
                            return (
                              <div
                                key={s.id}
                                draggable
                                onDragStart={(e) => {
                                  setDraggedStudentId(s.id);
                                  setSourceGroupId(group.groupId);
                                  e.dataTransfer.setData("text/plain", s.id);
                                }}
                                onDragEnd={() => {
                                  setDraggedStudentId(null);
                                  setSourceGroupId(null);
                                  setDragOverGroupId(null);
                                }}
                                className={cn(
                                  "bg-background flex cursor-grab items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition hover:border-primary/40 active:cursor-grabbing",
                                  isBeingDragged && "scale-95 opacity-30",
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={cn(
                                      "size-1.5 shrink-0 rounded-full",
                                      s.gender === "M"
                                        ? "bg-blue-500"
                                        : s.gender === "F"
                                          ? "bg-pink-500"
                                          : "bg-muted-foreground",
                                    )}
                                  />
                                  {s.stuNum ? (
                                    <span className="text-muted-foreground tabular text-xs font-semibold">
                                      {s.stuNum}
                                    </span>
                                  ) : null}
                                  <span className="truncate font-bold">
                                    {s.name}
                                  </span>
                                </div>

                                <div className="flex shrink-0 items-center gap-1">
                                  {s.academicLevel ? (
                                    <Badge
                                      variant="secondary"
                                      className="font-normal"
                                    >
                                      {s.academicLevel === "high"
                                        ? "상"
                                        : s.academicLevel === "mid"
                                          ? "중"
                                          : "하"}
                                    </Badge>
                                  ) : null}
                                  {s.engagement ? (
                                    <Badge
                                      variant="outline"
                                      className="font-normal"
                                    >
                                      {s.engagement === "active"
                                        ? "적극"
                                        : s.engagement === "passive"
                                          ? "소극"
                                          : "보통"}
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

        <UnifiedClassDialog
          open={unifiedDialogOpen}
          onOpenChange={setUnifiedDialogOpen}
          currentClass={unifiedDialogMode === "create" ? null : currentClass}
          initialMode={unifiedDialogMode}
          initialStep={unifiedDialogStep}
          options={options}
          onOptionsChange={setOptions}
          relationships={relationships}
          onSaveClass={handleSaveClassAndStudents}
          onExecuteGroupingAndSave={handleExecuteGroupingAndSave}
        />
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>학급을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `‘${deleteTarget.name}’ 학급과 학생 명단, 모둠 편성이 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteClass();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "삭제하는 중…" : "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
