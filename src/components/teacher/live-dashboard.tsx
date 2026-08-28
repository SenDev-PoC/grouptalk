import { Hand, Radio, Square, Timer, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { GroupCard } from '@/components/common/group-card'
import { GroupDetailDialog } from '@/components/common/group-detail-dialog'
import { JoinCodeDialog } from '@/components/common/join-code-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { data } from '@/data'
import type { SessionSnapshot } from '@/data/types'
import { useNow } from '@/hooks/use-now'
import { formatElapsed } from '@/lib/format'
import { resolveGroupStatus } from '@/lib/group-status'

export function LiveDashboard({ snapshot }: { snapshot: SessionSnapshot }) {
  const { session, groups, insights, helpRequests } = snapshot
  const now = useNow(1000)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)

  const insightByGroup = useMemo(
    () => new Map(insights.map((insight) => [insight.groupId, insight])),
    [insights],
  )

  const openHelp = useMemo(
    () => helpRequests.filter((request) => request.resolvedAt === null),
    [helpRequests],
  )
  const helpOrderByGroup = useMemo(
    () => new Map(openHelp.map((request, index) => [request.groupId, index + 1])),
    [openHelp],
  )

  /** 먼저 살펴볼 후보가 위로 오도록 정렬한다. */
  const orderedGroups = useMemo(() => {
    return [...groups]
      .filter((group) => group.joinedAt !== null)
      .map((group) => ({
        group,
        status: resolveGroupStatus(group, insightByGroup.get(group.id), now),
      }))
      .sort((a, b) => {
        const helpA = helpOrderByGroup.get(a.group.id) ?? Number.MAX_SAFE_INTEGER
        const helpB = helpOrderByGroup.get(b.group.id) ?? Number.MAX_SAFE_INTEGER
        if (helpA !== helpB) return helpA - helpB
        if (a.status.priority !== b.status.priority) return b.status.priority - a.status.priority
        return a.group.name.localeCompare(b.group.name, 'ko')
      })
  }, [groups, insightByGroup, helpOrderByGroup, now])

  const participantCount = groups
    .filter((group) => group.joinedAt !== null)
    .reduce((sum, group) => sum + group.members.length, 0)

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null

  async function endActivity() {
    setEnding(true)
    try {
      await data().setSessionStatus(session.id, 'ended')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '활동을 종료하지 못했습니다.')
      setEnding(false)
    }
  }

  async function resolveHelp(groupId: string) {
    const request = openHelp.find((item) => item.groupId === groupId)
    if (!request) return
    try {
      await data().resolveHelp(request.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '도움 요청을 처리하지 못했습니다.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{session.title}</h1>
            <Badge className="bg-success text-success-foreground">
              <Radio className="size-3 animate-soft-pulse" />
              진행 중
            </Badge>
            {/* 늦게 들어오는 모둠이 있을 수 있어 진행 중에도 입장 코드를 꺼낼 수 있어야 한다. */}
            <JoinCodeDialog joinCode={session.joinCode} />
          </div>
          <p className="text-muted-foreground text-sm">
            상태는 먼저 살펴볼 모둠을 찾기 위한 신호이며 학생 평가가 아닙니다.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Stat icon={Timer} label="경과" value={formatElapsed(session.startedAt, now)} />
          <Stat icon={Users} label="참여 인원" value={`${participantCount}명`} />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="lg">
                <Square className="size-4" />
                활동 종료
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>활동을 종료할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  모든 모둠 기기의 대화 수집이 멈추고 학생 화면도 종료 화면으로 바뀝니다. 종료 후에는
                  사후 리포트에서 결과를 확인할 수 있습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction
                  onClick={endActivity}
                  disabled={ending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  활동 종료
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {openHelp.length > 0 && (
        <Card className="border-warning/50 bg-warning-soft py-4">
          <CardContent className="flex flex-wrap items-center gap-3 px-5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Hand className="text-warning size-4" />
              도움 요청 {openHelp.length}건
            </span>
            <div className="flex flex-wrap gap-1.5">
              {openHelp.map((request, index) => {
                const group = groups.find((item) => item.id === request.groupId)
                return (
                  <Button
                    key={request.id}
                    variant="outline"
                    size="sm"
                    className="bg-background"
                    onClick={() => resolveHelp(request.groupId)}
                  >
                    {index + 1}. {group?.name ?? '알 수 없는 모둠'} · 확인함
                  </Button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {orderedGroups.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <p className="text-sm font-medium">입장한 모둠이 없습니다</p>
            <p className="text-muted-foreground mt-1.5 text-sm">
              입장 코드 {session.joinCode}로 모둠 기기가 들어오면 여기에 표시됩니다.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {orderedGroups.map(({ group, status }) => (
            <GroupCard
              key={group.id}
              group={group}
              insight={insightByGroup.get(group.id)}
              status={status}
              steps={session.steps}
              helpOrder={helpOrderByGroup.get(group.id) ?? null}
              onClick={() => setSelectedGroupId(group.id)}
            />
          ))}
        </div>
      )}

      <GroupDetailDialog
        group={selectedGroup}
        insight={selectedGroup ? insightByGroup.get(selectedGroup.id) : undefined}
        steps={session.steps}
        open={selectedGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedGroupId(null)
        }}
      />
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border px-4 py-2">
      <Icon className="text-muted-foreground size-4" />
      <div>
        <p className="text-muted-foreground text-xs leading-tight">{label}</p>
        <p className="tabular text-sm leading-tight font-semibold">{value}</p>
      </div>
    </div>
  )
}
