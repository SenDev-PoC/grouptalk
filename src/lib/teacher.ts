const TEACHER_ID_KEY = 'moodumview.teacherId'

/** 데모 모드에서 첫 계정이 기존 로컬 수업 데이터를 이어받도록 식별자를 읽는다. */
export function peekLocalTeacherId(): string | null {
  return localStorage.getItem(TEACHER_ID_KEY)
}

/** Supabase가 없는 로컬 데모에서만 사용하는 브라우저 교사 식별자. */
export function getTeacherId(): string {
  const stored = peekLocalTeacherId()
  if (stored) return stored
  const created = `teacher_${crypto.randomUUID()}`
  localStorage.setItem(TEACHER_ID_KEY, created)
  return created
}
