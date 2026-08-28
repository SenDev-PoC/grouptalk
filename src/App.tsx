import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Toaster } from '@/components/ui/sonner'
import NotFoundPage from '@/pages/NotFoundPage'

// 교사용과 학생용은 서로 다른 기기에서 열린다.
// 특히 LiveKit은 학생 화면에서만 필요하므로 라우트 단위로 나눠 받는다.
const TeacherHomePage = lazy(() => import('@/pages/teacher/TeacherHomePage'))
const GroupFormationPage = lazy(() => import('@/pages/teacher/GroupFormationPage'))
const TeacherSessionPage = lazy(() => import('@/pages/teacher/TeacherSessionPage'))
const TeacherReportPage = lazy(() => import('@/pages/teacher/TeacherReportPage'))
const JoinPage = lazy(() => import('@/pages/student/JoinPage'))
const StudentRoomPage = lazy(() => import('@/pages/student/StudentRoomPage'))

export default function App() {
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/teacher" replace />} />
          <Route path="/teacher" element={<TeacherHomePage />} />
          <Route path="/teacher/group-form" element={<GroupFormationPage />} />
          <Route path="/teacher/activity/:activityId" element={<TeacherSessionPage />} />
          <Route path="/teacher/activity/:activityId/report" element={<TeacherReportPage />} />
          <Route path="/join/:joinCode" element={<JoinPage />} />
          <Route path="/student/:activityId" element={<StudentRoomPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <Toaster richColors />
    </>
  )
}

function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <span className="bg-primary/70 size-2.5 animate-soft-pulse rounded-full" />
      <span className="sr-only">불러오는 중</span>
    </div>
  )
}
