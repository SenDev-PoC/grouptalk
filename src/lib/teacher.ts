const TEACHER_ID_KEY = 'moodumview.teacherId'

/** 데모 모드에서 첫 계정이 기존 로컬 수업 데이터를 이어받도록 식별자를 읽는다. */
export function peekLocalTeacherId(): string | null {
  return localStorage.getItem(TEACHER_ID_KEY)
}
