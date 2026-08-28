import type { Session } from '@supabase/supabase-js'

import { getSupabase } from '@/data/supabase'

export class StudentAuthError extends Error {}

/**
 * 학생 기기는 입장 전에 anonymous Auth 세션을 하나 만들고 계속 재사용한다.
 * 교사 계정이 로그인된 브라우저를 학생 세션으로 암묵적으로 바꾸지는 않는다.
 */
export async function ensureAnonymousStudentSession(): Promise<Session> {
  const db = getSupabase()
  const { data, error } = await db.auth.getSession()
  if (error) throw new StudentAuthError(error.message)

  if (data.session) {
    if (data.session.user.is_anonymous) return data.session
    throw new StudentAuthError('교사 계정이 로그인된 브라우저에서는 학생으로 입장할 수 없습니다.')
  }

  const result = await db.auth.signInAnonymously()
  if (result.error) throw new StudentAuthError(result.error.message)
  if (!result.data.session || !result.data.user?.is_anonymous) {
    throw new StudentAuthError('학생 인증 세션을 만들지 못했습니다.')
  }
  return result.data.session
}
