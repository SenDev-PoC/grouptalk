import { useContext } from 'react'

import { TeacherIdContext } from '@/lib/teacher-auth-context'

export function useTeacherId() {
  const teacherId = useContext(TeacherIdContext)
  if (!teacherId) throw new Error('교사 인증 경계 밖에서 교사 ID를 요청했습니다.')
  return teacherId
}
