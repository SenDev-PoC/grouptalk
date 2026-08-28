import type { ConnectionState, Group, GroupInsight, ParticipationState } from '@/types/domain'

/**
 * 교사 화면이 실제로 보여주는 단일 상태.
 * 기술 문제(연결/최신성)와 참여 경향을 하나로 합치지 않기 위해 별도 타입으로 둔다.
 */
export type GroupDisplayState =
  | 'not_ready'
  | 'balanced'
  | 'skewed'
  | 'insufficient'
  | 'stale'
  | 'unknown'
  | 'lost'

/** 이 시간 넘게 분석 갱신이 없으면 지난 경향을 현재 상태처럼 보여주지 않는다. */
export const STALE_AFTER_MS = 45_000
/** 기기 하트비트가 이 시간 넘게 끊기면 연결 실패로 본다. */
export const CONNECTION_LOST_AFTER_MS = 20_000

export interface GroupStatus {
  state: GroupDisplayState
  label: string
  /** 교사가 취할 다음 행동. 참여 문제와 기술 문제에 서로 다른 안내를 준다. */
  action: string
  /** 우선 확인 정렬용. 클수록 먼저 살펴볼 후보다. */
  priority: number
  tone: 'balanced' | 'skewed' | 'insufficient' | 'offline'
}

const STATUS_TABLE: Record<GroupDisplayState, Omit<GroupStatus, 'state'>> = {
  lost: {
    label: '연결 실패',
    action: '참여 문제가 아닙니다. 모둠 기기의 연결을 먼저 확인하세요.',
    priority: 40,
    tone: 'offline',
  },
  stale: {
    label: '갱신 중단',
    action: '최근 상태를 알 수 없습니다. 수집이 이어지는지 확인하세요.',
    priority: 30,
    tone: 'offline',
  },
  skewed: {
    label: '편중 경향',
    action: '한 화자 중심 경향이 관찰됩니다. 먼저 살펴볼 후보입니다.',
    priority: 20,
    tone: 'skewed',
  },
  unknown: {
    label: '판단 불가',
    action: '지금 정보로는 경향을 신뢰할 수 없습니다. 직접 확인이 필요합니다.',
    priority: 15,
    tone: 'insufficient',
  },
  insufficient: {
    label: '정보 부족',
    action: '아직 판단할 근거가 부족합니다. 조금 더 기다려 보세요.',
    priority: 10,
    tone: 'insufficient',
  },
  not_ready: {
    label: '준비 전',
    action: '아직 모둠 기기가 들어오지 않았습니다.',
    priority: 5,
    tone: 'insufficient',
  },
  balanced: {
    label: '고른 참여',
    action: '지금 즉시 확인할 우선순위는 낮습니다.',
    priority: 0,
    tone: 'balanced',
  },
}

function isElapsed(timestamp: string | null, limitMs: number, now: number) {
  if (!timestamp) return true
  return now - new Date(timestamp).getTime() > limitMs
}

/** 하트비트가 끊긴 기기를 계속 접속 중으로 보여주지 않도록 저장된 상태를 보정한다. */
export function resolveConnectionState(group: Group, now = Date.now()): ConnectionState {
  if (!group.joinedAt) return 'not_ready'
  if (group.connectionState === 'live' && isElapsed(group.lastSeenAt, CONNECTION_LOST_AFTER_MS, now))
    return 'lost'
  return group.connectionState
}

/**
 * 모둠 하나의 표시 상태를 정한다. 우선순위 규칙:
 * 연결/최신성 문제 → 참여 경향 유보. (06-api-contract 의미 충돌 해결 원칙)
 */
export function resolveGroupStatus(
  group: Group,
  insight: GroupInsight | undefined,
  now = Date.now(),
): GroupStatus {
  const connection = resolveConnectionState(group, now)

  let state: GroupDisplayState
  if (connection === 'not_ready') {
    state = 'not_ready'
  } else if (connection === 'lost') {
    state = 'lost'
  } else if (!insight || !insight.updatedAt) {
    state = 'insufficient'
  } else if (isElapsed(insight.updatedAt, STALE_AFTER_MS, now)) {
    state = 'stale'
  } else {
    state = participationToDisplay(insight.participationState)
  }

  return { state, ...STATUS_TABLE[state] }
}

/**
 * 종료된 활동의 최종 상태. 사후 리포트에서는 최신성·연결이 더 이상 판단 대상이 아니므로
 * 실시간 규칙을 적용하지 않고 마지막 분석 결과를 그대로 보여준다.
 */
export function resolveFinalStatus(insight: GroupInsight | undefined): GroupStatus {
  const state: GroupDisplayState = insight?.updatedAt
    ? participationToDisplay(insight.participationState)
    : 'insufficient'
  return { state, ...STATUS_TABLE[state] }
}

function participationToDisplay(participation: ParticipationState): GroupDisplayState {
  switch (participation) {
    case 'balanced':
      return 'balanced'
    case 'skewed':
      return 'skewed'
    case 'insufficient':
      return 'insufficient'
    case 'unknown':
      return 'unknown'
  }
}

export const TONE_CLASS: Record<GroupStatus['tone'], string> = {
  balanced: 'bg-success-soft text-success border-success/30',
  skewed: 'bg-danger-soft text-danger border-danger/35',
  insufficient: 'bg-warning-soft text-warning border-warning/30',
  offline: 'bg-danger-soft text-danger border-danger/35',
}

export const TONE_BAR_CLASS: Record<GroupStatus['tone'], string> = {
  balanced: 'bg-success',
  skewed: 'bg-danger',
  insufficient: 'bg-warning',
  offline: 'bg-danger',
}
