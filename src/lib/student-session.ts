const KEY_PREFIX = 'moodumview.student.'
const LAST_KEY = 'moodumview.student.last'

export interface StoredStudentSession {
  sessionId: string
  groupId: string
  groupName: string
  memberNames: string[]
  clientDeviceKey: string
}

function parse(raw: string | null): StoredStudentSession | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as StoredStudentSession
    return value.sessionId && value.groupId
      ? {
          ...value,
          clientDeviceKey:
            typeof value.clientDeviceKey === 'string' ? value.clientDeviceKey : '',
        }
      : null
  } catch {
    return null
  }
}

export function readStudentSession(sessionId: string): StoredStudentSession | null {
  return parse(localStorage.getItem(KEY_PREFIX + sessionId))
}

/** 다른 활동에 다시 들어올 때 모둠 이름·모둠원을 미리 채우기 위한 마지막 입력. */
export function readLastStudentSession(): StoredStudentSession | null {
  return parse(localStorage.getItem(LAST_KEY))
}

export function writeStudentSession(value: StoredStudentSession) {
  localStorage.setItem(KEY_PREFIX + value.sessionId, JSON.stringify(value))
  localStorage.setItem(LAST_KEY, JSON.stringify(value))
}

export function clearStudentSession(sessionId: string) {
  localStorage.removeItem(KEY_PREFIX + sessionId)
}
