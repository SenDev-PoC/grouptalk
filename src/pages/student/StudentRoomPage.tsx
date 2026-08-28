import { Hand, Mic, PartyPopper, RefreshCw, WifiOff } from 'lucide-react'
import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { MobileShell } from '@/components/common/mobile-shell'
import { MicRing } from '@/components/student/mic-ring'
import { StudentParticipationAlerts } from '@/components/student/participation-alerts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { data } from '@/data'
import { useMicSession } from '@/hooks/use-mic-session'
import { useNow } from '@/hooks/use-now'
import { useSessionSnapshot } from '@/hooks/use-session-snapshot'
import { resolveGroupStatus } from '@/lib/group-status'
import { readStudentSession } from '@/lib/student-session'
import { cn } from '@/lib/utils'
import NotFoundPage from '@/pages/NotFoundPage'

export default function StudentRoomPage() {
  const { activityId } = useParams<{ activityId: string }>()
  const { snapshot, loading, notFound } = useSessionSnapshot(activityId, {
    pollingEnabled: true,
  })

  const stored = useMemo(
    () => (activityId ? readStudentSession(activityId) : null),
    [activityId],
  )

  const group = snapshot?.groups.find((item) => item.id === stored?.groupId) ?? null
  const session = snapshot?.session ?? null
  const isActive = session?.status === 'active'

  const mic = useMicSession({
    sessionId: session?.id ?? '',
    groupId: group?.id ?? '',
    groupName: group?.name ?? '',
    clientDeviceKey: stored?.clientDeviceKey ?? '',
    enabled: Boolean(isActive && group && stored?.clientDeviceKey),
  })

  const openHelp = snapshot?.helpRequests.find(
    (request) => request.groupId === group?.id && request.resolvedAt === null,
  )

  const now = useNow(5_000)
  const insight = useMemo(
    () => snapshot?.insights.find((item) => item.groupId === group?.id),
    [snapshot?.insights, group?.id],
  )
  const groupStatus = group ? resolveGroupStatus(group, insight, now) : null

  if (loading) {
    return (
      <MobileShell centered>
        <Card className="w-full gap-0 py-0">
          <CardContent className="space-y-3 px-4 py-5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="mx-auto size-28 rounded-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </MobileShell>
    )
  }

  if (notFound || !snapshot || !session) return <NotFoundPage />

  // 이 브라우저의 입장 기록이 없으면 다시 입장 화면으로 보낸다.
  if (!stored || !stored.clientDeviceKey || !group) {
    return <Navigate to={`/join/${session.joinCode}`} replace />
  }

  if (session.status === 'ended') {
    return (
      <MobileShell centered>
        <Card className="w-full gap-0 py-0">
          <CardHeader className="justify-items-center gap-4 px-4 pt-6 pb-0 text-center">
            <div className="bg-success-soft text-success relative flex size-16 items-center justify-center rounded-full">
              <PartyPopper className="size-7" />
            </div>
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs">{session.title}</p>
              <h1 className="text-lg font-bold">수고했어요!</h1>
              <p className="text-muted-foreground text-sm leading-relaxed">{group.name}의 활동이 끝났습니다.</p>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 px-4 pt-4 pb-5">
            {group.members.length > 0 && (
              <p className="text-muted-foreground text-center text-xs leading-relaxed">
                {group.members.map((member) => member.name).join(' · ')}
              </p>
            )}
          </CardContent>
        </Card>
      </MobileShell>
    )
  }

  if (session.status === 'waiting') {
    return (
      <MobileShell centered>
        <Card className="w-full gap-0 py-0">
          <CardHeader className="justify-items-center gap-4 px-4 pt-6 pb-0 text-center">
            <WaitingLoader />
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs">{session.title}</p>
              <h1 className="text-lg font-bold">입장 완료</h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {group.name}
                <br />
                선생님이 활동을 시작할 때까지 잠시 기다려 주세요.
              </p>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2 px-4 pt-4 pb-5">
            {group.members.length > 0 && (
              <p className="text-muted-foreground text-xs">
                {group.members.map((member) => member.name).join(' · ')}
              </p>
            )}
          </CardContent>
        </Card>
      </MobileShell>
    )
  }

  async function requestHelp() {
    if (!group || openHelp) return
    try {
      await data().requestHelp(session!.id, group.id)
    } catch {
      // ignore
    }
  }

  async function selectStep(stepId: string) {
    if (!group) return
    try {
      await data().setGroupStep(group.id, stepId)
    } catch {
      // ignore
    }
  }

  return (
    <MobileShell className="overflow-hidden py-[max(0.5rem,env(safe-area-inset-top))]">
      <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <CardHeader className="shrink-0 gap-1 px-4 pt-4 pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-muted-foreground truncate text-xs">{session.title}</p>
              <h1 className="truncate text-lg leading-tight font-bold tracking-tight">
                {group.name}
              </h1>
            </div>
            {mic.localOnly && (
              <Badge variant="outline" className="border-warning/40 text-warning shrink-0">
                <WifiOff className="size-3" />
                기록 안 됨
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-3">
          {groupStatus && (
            <StudentParticipationAlerts
              className="shrink-0"
              statusState={groupStatus.state}
              insight={insight}
            />
          )}

          <div className="flex shrink-0 flex-col items-center gap-2 py-1">
            <MicRing phase={mic.phase} level={mic.level} onToggle={mic.toggleMute} />
            {mic.phase === 'idle' && (
              <Button size="sm" onClick={mic.connect}>
                <Mic className="size-4" />
                마이크 연결하기
              </Button>
            )}
            {mic.phase === 'error' && (
              <Button variant="outline" size="sm" onClick={mic.reconnect}>
                <RefreshCw className="size-4" />
                다시 연결
              </Button>
            )}
          </div>

          <section className="min-h-0 space-y-1.5">
            <p className="text-xs font-medium">지금 우리 모둠의 단계</p>
            <div className="grid gap-1.5">
              {session.steps.map((step, index) => {
                const selected = step.id === group.currentStepId
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => selectStep(step.id)}
                    className={cn(
                      'flex min-h-10 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                      selected
                        ? 'border-primary bg-card shadow-xs ring-1 ring-primary/15'
                        : 'bg-card active:bg-sand-soft',
                    )}
                  >
                    <span
                      className={cn(
                        'tabular flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        selected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium">{step.label}</span>
                  </button>
                )
              })}
            </div>
          </section>
        </CardContent>

        <CardFooter className="shrink-0 flex w-full flex-col border-t px-4 pt-3 pb-4">
          <Button
            variant={openHelp ? 'warning-soft' : 'warning'}
            size="lg"
            className="w-full"
            onClick={requestHelp}
            disabled={Boolean(openHelp)}
          >
            <Hand className="size-4" />
            {openHelp ? '선생님을 기다리는 중' : '선생님 도와주세요'}
          </Button>
        </CardFooter>
      </Card>
    </MobileShell>
  )
}

function WaitingLoader() {
  return (
    <div className="relative flex size-16 items-center justify-center" aria-hidden>
      <span className="border-primary/35 absolute inset-0 rounded-full border-2 animate-waiting-ring" />
      <span
        className="border-primary/25 absolute inset-1 rounded-full border-2 animate-waiting-ring"
        style={{ animationDelay: '0.6s' }}
      />
      <div className="bg-primary/10 text-primary relative flex size-12 items-center justify-center rounded-full">
        <div className="flex items-center gap-1">
          <span className="bg-primary size-1.5 rounded-full animate-waiting-bounce" />
          <span
            className="bg-primary size-1.5 rounded-full animate-waiting-bounce"
            style={{ animationDelay: '0.15s' }}
          />
          <span
            className="bg-primary size-1.5 rounded-full animate-waiting-bounce"
            style={{ animationDelay: '0.3s' }}
          />
        </div>
      </div>
    </div>
  )
}
