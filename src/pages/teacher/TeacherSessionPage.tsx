import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { TeacherShell } from '@/components/common/teacher-shell'
import { LiveDashboard } from '@/components/teacher/live-dashboard'
import { WaitingRoom } from '@/components/teacher/waiting-room'
import { Skeleton } from '@/components/ui/skeleton'
import { isDemoMode } from '@/data'
import { startDemoAnalysis } from '@/data/demo'
import { useSessionSnapshot } from '@/hooks/use-session-snapshot'
import NotFoundPage from '@/pages/NotFoundPage'

export default function TeacherSessionPage() {
  const { activityId } = useParams<{ activityId: string }>()
  const { snapshot, loading, notFound } = useSessionSnapshot(activityId)
  const isActive = snapshot?.session.status === 'active'

  // 데모 모드에서는 백엔드 분석이 없으므로 대시보드를 여는 탭이 합성 상태를 만든다.
  useEffect(() => {
    if (!isDemoMode || !activityId || !isActive) return
    return startDemoAnalysis(activityId)
  }, [activityId, isActive])

  if (loading) {
    return (
      <TeacherShell wide>
        <div className="space-y-6">
          <Skeleton className="h-12 w-80" />
          <Skeleton className="h-72 w-full" />
        </div>
      </TeacherShell>
    )
  }

  if (notFound || !snapshot) return <NotFoundPage />

  if (snapshot.session.status === 'ended') {
    return <Navigate to={`/teacher/activity/${snapshot.session.id}/report`} replace />
  }

  return (
    <TeacherShell wide={snapshot.session.status === 'active'}>
      {snapshot.session.status === 'waiting' ? (
        <WaitingRoom snapshot={snapshot} />
      ) : (
        <LiveDashboard snapshot={snapshot} />
      )}
    </TeacherShell>
  )
}
