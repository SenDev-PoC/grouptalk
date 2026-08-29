import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { RouteFallback } from '@/components/common/route-fallback'
import { useAuth } from '@/hooks/use-auth'
import { TeacherIdContext } from '@/lib/teacher-auth-context'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <RouteFallback />
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return (
    <TeacherIdContext.Provider value={user.id}>
      <Outlet />
    </TeacherIdContext.Provider>
  )
}

export function GuestOnly() {
  const { user, loading } = useAuth()

  if (loading) return <RouteFallback />
  if (user) return <Navigate to="/teacher" replace />
  return <Outlet />
}
