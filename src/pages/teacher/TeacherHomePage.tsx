import { FileText, Play, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { EmptyState } from '@/components/common/empty-state'
import { TeacherShell } from '@/components/common/teacher-shell'
import { CreateActivityDialog } from '@/components/teacher/create-activity-dialog'
import { GroupFormationView } from '@/components/teacher/group-formation/group-formation-view'
import { StartActivityDialog } from '@/components/teacher/start-activity-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { data } from '@/data'
import { useTeacherId } from '@/hooks/use-teacher-id'
import { formatDateTime, formatDuration } from '@/lib/format'
import type { Activity, SessionSummary } from '@/types/domain'

export default function TeacherHomePage() {
  const teacherId = useTeacherId()
  const navigate = useNavigate()

  const [activities, setActivities] = useState<Activity[] | null>(null)
  const [history, setHistory] = useState<SessionSummary[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [startTarget, setStartTarget] = useState<Activity | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadActivities = useCallback(() => {
    void data()
      .listActivities(teacherId)
      .then(setActivities)
      .catch(() => setActivities([]))
  }, [teacherId])

  const loadHistory = useCallback(() => {
    void data()
      .listSessionHistory(teacherId)
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [teacherId])

  useEffect(() => {
    loadActivities()
    loadHistory()
  }, [loadActivities, loadHistory])

  function handleSessionStarted() {
    loadHistory()
  }

  async function confirmRemoveActivity() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await data().deleteActivity(deleteTarget.id)
      setActivities((prev) => prev?.filter((item) => item.id !== deleteTarget.id) ?? null)
      setDeleteTarget(null)
    } catch {
      // ignore
    } finally {
      setDeleting(false)
    }
  }

  return (
    <TeacherShell>
      <Tabs defaultValue="activities">
        <TabsList>
          <TabsTrigger value="activities">내 활동</TabsTrigger>
          <TabsTrigger value="history">활동 기록</TabsTrigger>
          <TabsTrigger value="students">모둠 편성</TabsTrigger>
        </TabsList>

        <TabsContent value="activities" className="space-y-4 pt-2">
          {activities === null ? (
            <ListSkeleton />
          ) : activities.length === 0 ? (
            <EmptyState
              title="저장된 활동이 없습니다"
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  활동 만들기
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex justify-end">
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  활동 만들기
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {activities.map((activity) => (
                  <Card key={activity.id} className="h-full gap-0 py-0">
                    <CardContent className="flex h-full flex-col gap-4 px-5 py-5">
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="line-clamp-2 font-bold">{activity.title}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {activity.steps.map((step, index) => (
                            <Badge key={step.id} variant="secondary" className="font-normal">
                              {index + 1}. {step.label}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {formatDateTime(activity.createdAt)} 저장
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button className="flex-1" onClick={() => setStartTarget(activity)}>
                          <Play className="size-4" />
                          시작하기
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(activity)}
                          aria-label={`${activity.title} 삭제`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="pt-2">
          {history === null ? (
            <ListSkeleton />
          ) : history.length === 0 ? (
            <EmptyState
              title="종료된 활동이 없습니다"
              description="활동을 시작하고 종료하면 이곳에 활동 기록이 쌓입니다."
            />
          ) : (
            <div className="space-y-3">
              {history.map((session) => (
                <Card key={session.id} className="py-5">
                  <CardContent className="flex items-center justify-between gap-6 px-5">
                    <div className="min-w-0 space-y-1.5">
                      <p className="truncate font-bold">{session.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(session.startedAt ?? session.endedAt)} · 진행{' '}
                        {formatDuration(session.startedAt, session.endedAt)} · 모둠{' '}
                        {session.groupCount}개
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="shrink-0"
                      onClick={() => navigate(`/teacher/activity/${session.id}/report`)}
                    >
                      <FileText className="size-4" />
                      기록 보기
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="students" className="pt-2">
          <GroupFormationView
            teacherId={teacherId}
            onOpenDashboard={() => {
              if (activities && activities.length > 0) {
                setStartTarget(activities[0])
              } else {
                setCreateOpen(true)
              }
            }}
          />
        </TabsContent>
      </Tabs>

      <CreateActivityDialog
        teacherId={teacherId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(activity) => setActivities((prev) => [activity, ...(prev ?? [])])}
      />

      <StartActivityDialog
        teacherId={teacherId}
        activity={startTarget}
        onOpenChange={(open) => {
          if (!open) setStartTarget(null)
        }}
        onStarted={handleSessionStarted}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>활동을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `‘${deleteTarget.title}’ 활동을 삭제합니다. 저장된 활동 템플릿만 지워지며, 이미 진행·종료된 활동 기록은 남습니다.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmRemoveActivity()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? '삭제하는 중…' : '삭제'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TeacherShell>
  )
}

function ListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
