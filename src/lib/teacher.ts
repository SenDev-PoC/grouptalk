const TEACHER_ID_KEY = 'moodumview.teacherId'

/**
 * 해커톤 범위에서는 로그인을 두지 않는다.
 * 교사 식별자는 브라우저에 저장해 활동·기록·모둠 배정을 이어 준다.
 */
export function getTeacherId(): string {
  const stored = localStorage.getItem(TEACHER_ID_KEY)
  if (stored) return stored
  const created = `teacher_${crypto.randomUUID()}`
  localStorage.setItem(TEACHER_ID_KEY, created)
  return created
}
