/** 활동 세션의 수명. 교사만 바꿀 수 있고 학생 화면은 이 값을 따라간다. */
export type SessionStatus = 'waiting' | 'active' | 'ended'

/** 모둠 공용 기기의 기술 상태. 참여 상태와 절대 합치지 않는다. */
export type ConnectionState = 'not_ready' | 'connecting' | 'live' | 'lost'

/** 백엔드 분석이 내리는 참여 경향. 학생 평가 점수가 아니다. */
export type ParticipationState = 'balanced' | 'skewed' | 'insufficient' | 'unknown'

export interface ActivityStep {
  id: string
  position: number
  label: string
}

export interface Activity {
  id: string
  teacherId: string
  title: string
  createdAt: string
  steps: ActivityStep[]
}

export interface Session {
  id: string
  activityId: string
  teacherId: string
  title: string
  joinCode: string
  status: SessionStatus
  useRoster: boolean
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  steps: ActivityStep[]
}

export interface GroupMember {
  id: string
  name: string
}

export interface Group {
  id: string
  sessionId: string
  name: string
  joinedAt: string | null
  currentStepId: string | null
  connectionState: ConnectionState
  lastSeenAt: string | null
  members: GroupMember[]
}

export interface SpeakerShare {
  /** 익명 화자 표시. 학생 이름과 동일시하지 않는다. */
  speakerLabel: string
  ratio: number
  utteranceCount: number
}

export interface OffTopicEvidence {
  quote: string
  reason: string
  at: string | null
}

/** 백엔드(Deepgram 전사 + LLM 분석)가 채우는 파생 정보. */
export interface GroupInsight {
  groupId: string
  sessionId: string
  participationState: ParticipationState
  speakerShares: SpeakerShare[]
  offTopicRatio: number | null
  offTopicEvidence: OffTopicEvidence[]
  summary: string | null
  keywords: string[]
  updatedAt: string | null
}

export interface Utterance {
  id: string
  sessionId: string
  groupId: string
  speakerLabel: string
  text: string
  spokenAt: string
}

export interface HelpRequest {
  id: string
  sessionId: string
  groupId: string
  createdAt: string
  resolvedAt: string | null
}

export interface RosterGroup {
  id: string
  teacherId: string
  name: string
  position: number
  students: { id: string; name: string }[]
}

export interface SessionSummary {
  id: string
  title: string
  joinCode: string
  status: SessionStatus
  startedAt: string | null
  endedAt: string | null
  groupCount: number
}
