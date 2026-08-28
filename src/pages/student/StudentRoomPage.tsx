import { CheckCircle2, Hand, Hourglass, PartyPopper, RefreshCw, WifiOff } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { MobileShell } from '@/components/common/mobile-shell'
import { MicRing } from '@/components/student/mic-ring'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { data } from '@/data'
import { useMicSession } from '@/hooks/use-mic-session'
import { useSessionSnapshot } from '@/hooks/use-session-snapshot'
import { readStudentSession } from '@/lib/student-session'
import { cn } from '@/lib/utils'
import NotFoundPage from '@/pages/NotFoundPage'

export default function StudentRoomPage() {
  const { activityId } = useParams<{ activityId: string }>()
  const { snapshot, loading, notFound } = useSessionSnapshot(activityId)

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
    enabled: Boolean(isActive && group),
  })

  const openHelp = snapshot?.helpRequests.find(
    (request) => request.groupId === group?.id && request.resolvedAt === null,
  )

  useEffect(() => {
    if (mic.error) toast.error(mic.error)
  }, [mic.error])

  if (loading) {
    return (
      <MobileShell className="gap-4 pt-16">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-56 w-full" />
      </MobileShell>
    )
  }

  if (notFound || !snapshot || !session) return <NotFoundPage />

  // 이 브라우저의 입장 기록이 없으면 다시 입장 화면으로 보낸다.
  if (!stored || !group) {
    return <Navigate to={`/join/${session.joinCode}`} replace />
  }

  if (session.status === 'ended') {
    return (
      <MobileShell className="items-center justify-center gap-6 text-center">
        <div className="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-2xl">
          <PartyPopper className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">수고했어요!</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {group.name}의 활동이 끝났습니다. 대화 수집도 함께 종료되어 더 이상 기록되지 않습니다.
          </p>
        </div>
        <div className="text-muted-foreground w-full rounded-lg border px-4 py-3 text-left text-xs leading-relaxed">
          오늘 나눈 대화는 선생님이 모둠별 참여 상태를 확인하는 데 사용됩니다. 개인을 평가하는 데는
          쓰이지 않습니다.
        </div>
      </MobileShell>
    )
  }

  if (session.status === 'waiting') {
    return (
      <MobileShell className="items-center justify-center gap-6 text-center">
        <div className="bg-success-soft text-success flex size-16 items-center justify-center rounded-2xl">
          <CheckCircle2 className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">입장 완료</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {group.name}으로 입장했어요. 선생님이 활동을 시작할 때까지 잠시 기다려 주세요.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
          <Hourglass className="size-3.5 animate-soft-pulse" />
          시작 대기 중
        </Badge>
        {group.members.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {group.members.map((member) => member.name).join(' · ')}
          </p>
        )}
      </MobileShell>
    )
  }

  async function requestHelp() {
    if (!group || openHelp) return
    try {
      await data().requestHelp(session!.id, group.id)
      toast.success('선생님께 도움을 요청했어요.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '도움을 요청하지 못했습니다.')
    }
  }

  async function selectStep(stepId: string) {
    if (!group) return
    try {
      await data().setGroupStep(group.id, stepId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '단계를 바꾸지 못했습니다.')
    }
  }

  return (
    <MobileShell className="gap-6 pt-8">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-xs">{session.title}</p>
          <p className="truncate text-lg font-semibold">{group.name}</p>
        </div>
        {mic.localOnly && (
          <Badge variant="outline" className="border-warning/40 text-warning shrink-0">
            <WifiOff className="size-3" />
            기록 안 됨
          </Badge>
        )}
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <MicRing phase={mic.phase} level={mic.level} onToggle={mic.toggleMute} />
        {mic.phase === 'error' && (
          <Button variant="outline" onClick={mic.reconnect}>
            <RefreshCw className="size-4" />
            다시 연결
          </Button>
        )}
      </div>

      <section className="space-y-2.5">
        <p className="text-sm font-medium">지금 우리 모둠의 단계</p>
        <div className="grid gap-2">
          {session.steps.map((step, index) => {
            const selected = step.id === group.currentStepId
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => selectStep(step.id)}
                className={cn(
                  'flex min-h-13 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                  selected ? 'border-primary bg-accent' : 'bg-card active:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
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

      <Button
        variant={openHelp ? 'secondary' : 'outline'}
        size="xl"
        className="w-full"
        onClick={requestHelp}
        disabled={Boolean(openHelp)}
      >
        <Hand className="size-4" />
        {openHelp ? '선생님을 기다리는 중' : '선생님 도와주세요'}
      </Button>
    </MobileShell>
  )
}
