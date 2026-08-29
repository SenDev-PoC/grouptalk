import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'

import { GuestOnly, RequireAuth } from '@/components/auth/route-guards'
import { RouteFallback } from '@/components/common/route-fallback'
import NotFoundPage from '@/pages/NotFoundPage'

const LandingPage = lazy(() => import('@/pages/LandingPage'))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const SignupPage = lazy(() => import('@/pages/auth/SignupPage'))
const TeacherHomePage = lazy(() => import('@/pages/teacher/TeacherHomePage'))
const GroupFormationPage = lazy(() => import('@/pages/teacher/GroupFormationPage'))
const TeacherSessionPage = lazy(() => import('@/pages/teacher/TeacherSessionPage'))
const TeacherReportPage = lazy(() => import('@/pages/teacher/TeacherReportPage'))
const JoinPage = lazy(() => import('@/pages/student/JoinPage'))
const StudentRoomPage = lazy(() => import('@/pages/student/StudentRoomPage'))

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<GuestOnly />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route path="/teacher" element={<TeacherHomePage />} />
          <Route path="/teacher/group-form" element={<GroupFormationPage />} />
          <Route
            path="/teacher/activity/:activityId"
            element={<TeacherSessionPage />}
          />
          <Route
            path="/teacher/activity/:activityId/report"
            element={<TeacherReportPage />}
          />
        </Route>

        <Route path="/join/:joinCode" element={<JoinPage />} />
        <Route path="/student/:activityId" element={<StudentRoomPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}
