import { ArrowLeft, Download, Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { GroupCard, GROUP_CARD_GRID } from '@/components/common/group-card'
import { GroupDetailDialog } from '@/components/common/group-detail-dialog'
import { TeacherShell } from '@/components/common/teacher-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { data } from '@/data'
import { useSessionSnapshot } from '@/hooks/use-session-snapshot'
import { formatDateTime, formatDuration } from '@/lib/format'
import { resolveFinalStatus } from '@/lib/group-status'
import { buildTranscriptText, downloadTextFile } from '@/lib/transcript'
import NotFoundPage from '@/pages/NotFoundPage'
import type { Utterance } from '@/types/domain'

export default function TeacherReportPage() {
  const { activityId } = useParams<{ activityId: string }>()
  const { snapshot, loading, notFound } = useSessionSnapshot(activityId)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [utterances, setUtterances] = useState<Utterance[]>([])

  useEffect(() => {
    if (!activityId) return
    void data()
      .listUtterances(activityId)
      .then(setUtterances)
      .catch(() => setUtterances([]))
  }, [activityId])

  const insightByGroup = useMemo(
    () => new Map((snapshot?.insights ?? []).map((insight) => [insight.groupId, insight])),
    [snapshot],
  )

  if (loading) {
    return (
      <TeacherShell>
        <div className="space-y-6">
          <Skeleton className="h-12 w-80" />
          <Skeleton className="h-64 w-full" />
        </div>
      </TeacherShell>
    )
  }

  if (notFound || !snapshot) return <NotFoundPage />

  const { session, groups } = snapshot

  if (session.status !== 'ended') {
    return <Navigate to={`/teacher/activity/${session.id}`} replace />
  }

  const joinedGroups = groups.filter((group) => group.joinedAt !== null)
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null

  function download() {
    if (utterances.length === 0) return
    downloadTextFile(
      `모둠뷰_${session.title}_${session.joinCode}.txt`,
      buildTranscriptText(session, joinedGroups, utterances),
    )
  }

  return (
    <TeacherShell>
      <div className="mb-7 space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/teacher">
            <ArrowLeft className="size-4" />
            활동 기록으로
          </Link>
        </Button>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{session.title}</h1>
              <Badge variant="secondary">종료됨</Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {formatDateTime(session.startedAt)} 시작 · 진행{' '}
              {formatDuration(session.startedAt, session.endedAt)} · 모둠 {joinedGroups.length}개
            </p>
          </div>

          <Button variant="outline" onClick={download}>
            <Download className="size-4" />
            텍스트 변환 데이터 내려받기
          </Button>
        </div>
      </div>

      {joinedGroups.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <p className="text-sm font-medium">입장한 모둠이 없는 활동입니다</p>
            <p className="text-muted-foreground mt-1.5 text-sm">
              모둠 기기가 들어오지 않아 남은 참여 기록이 없습니다.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className={GROUP_CARD_GRID}>
          {joinedGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              insight={insightByGroup.get(group.id)}
              status={resolveFinalStatus(insightByGroup.get(group.id))}
              steps={session.steps}
              helpOrder={null}
              onClick={() => setSelectedGroupId(group.id)}
            />
          ))}
        </div>
      )}

      <div className="text-muted-foreground mt-7 flex items-start gap-2 rounded-lg border px-4 py-3.5">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p className="text-xs leading-relaxed">
          활동 종료로 실시간 수집은 끝났지만, 전사문과 참여 지표는 이 리포트에 남아 있습니다. 정보의
          보존 기간과 삭제 책임자는 실제 학교 도입 전에 정해야 하는 미결정 항목입니다.
        </p>
      </div>

      <GroupDetailDialog
        group={selectedGroup}
        insight={selectedGroup ? insightByGroup.get(selectedGroup.id) : undefined}
        status={
          selectedGroup ? resolveFinalStatus(insightByGroup.get(selectedGroup.id)) : undefined
        }
        steps={session.steps}
        open={selectedGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedGroupId(null)
        }}
      />
    </TeacherShell>
  )
}
