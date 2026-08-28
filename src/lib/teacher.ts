const TEACHER_ID_KEY = 'moodumview.teacherId'

/** Supabase가 없는 로컬 데모에서만 사용하는 브라우저 교사 식별자. */
export function getTeacherId(): string {
  const stored = localStorage.getItem(TEACHER_ID_KEY)
  if (stored) return stored
  const created = `teacher_${crypto.randomUUID()}`
  localStorage.setItem(TEACHER_ID_KEY, created)
  return created
}
