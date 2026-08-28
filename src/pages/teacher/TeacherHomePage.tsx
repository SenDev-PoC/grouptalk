import { CalendarClock, FileText, ListChecks, Play, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { EmptyState } from '@/components/common/empty-state'
import { TeacherShell } from '@/components/common/teacher-shell'
import { CreateActivityDialog } from '@/components/teacher/create-activity-dialog'
import { RosterManager } from '@/components/teacher/roster-manager'
import { StartActivityDialog } from '@/components/teacher/start-activity-dialog'
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

  /**
   * 대기실은 새 탭에서 연다. 팝업이 막히면 현재 탭으로 이동해
   * 교사가 아무 일도 일어나지 않았다고 느끼지 않게 한다.
   */
  function openWaitingRoom(sessionId: string) {
    const path = `/teacher/activity/${sessionId}`
    const opened = window.open(path, '_blank', 'noopener')
    if (opened) {
      loadHistory()
      return
    }
    navigate(path)
  }

  async function removeActivity(activity: Activity) {
    try {
      await data().deleteActivity(activity.id)
      setActivities((prev) => prev?.filter((item) => item.id !== activity.id) ?? null)
      toast.success('활동을 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '삭제하지 못했습니다.')
    }
  }

  return (
    <TeacherShell>
      <div className="mb-7 flex items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">교사 홈</h1>
        </div>
      </div>

      <Tabs defaultValue="activities">
        <TabsList>
          <TabsTrigger value="activities">내 활동</TabsTrigger>
          <TabsTrigger value="history">활동 기록</TabsTrigger>
          <TabsTrigger value="students">학생 관리</TabsTrigger>
        </TabsList>

        <TabsContent value="activities" className="pt-2">
          {activities === null ? (
            <ListSkeleton />
          ) : activities.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="저장된 활동이 없습니다"
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  활동 만들기
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {activities.map((activity) => (
                <Card key={activity.id} className="py-5">
                  <CardContent className="flex items-center justify-between gap-6 px-5">
                    <div className="min-w-0 space-y-2">
                      <p className="truncate font-medium">{activity.title}</p>
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
                      <Button onClick={() => setStartTarget(activity)}>
                        <Play className="size-4" />
                        시작하기
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeActivity(activity)}
                        aria-label={`${activity.title} 삭제`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="pt-2">
          {history === null ? (
            <ListSkeleton />
          ) : history.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="종료된 활동이 없습니다"
              description="활동을 시작하고 종료하면 이곳에 사후 리포트가 쌓입니다."
            />
          ) : (
            <div className="space-y-3">
              {history.map((session) => (
                <Card key={session.id} className="py-5">
                  <CardContent className="flex items-center justify-between gap-6 px-5">
                    <div className="min-w-0 space-y-1.5">
                      <p className="truncate font-medium">{session.title}</p>
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
          <RosterManager teacherId={teacherId} />
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
        onStarted={openWaitingRoom}
      />
    </TeacherShell>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  )
}
