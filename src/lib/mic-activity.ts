export type MicActivityPhase = 'listening' | 'speaking'

export const SPEAKING_ENTER_LEVEL = 0.08
export const SPEAKING_EXIT_LEVEL = 0.035
export const SPEAKING_ENTER_MS = 150
export const SPEAKING_EXIT_MS = 600

export interface MicActivityState {
  phase: MicActivityPhase
  transitionStartedAt: number | null
}

export function createMicActivityState(): MicActivityState {
  return { phase: 'listening', transitionStartedAt: null }
}

/** 짧은 소음과 음절 사이의 쉼이 화면 문구를 흔들지 않도록 전환을 지연한다. */
export function updateMicActivityState(
  state: MicActivityState,
  level: number,
  nowMs: number,
): MicActivityState {
  const normalizedLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  const transitionRequested =
    state.phase === 'listening'
      ? normalizedLevel >= SPEAKING_ENTER_LEVEL
      : normalizedLevel <= SPEAKING_EXIT_LEVEL

  if (!transitionRequested) {
    return state.transitionStartedAt === null
      ? state
      : { ...state, transitionStartedAt: null }
  }

  const transitionStartedAt =
    state.transitionStartedAt === null || nowMs < state.transitionStartedAt
      ? nowMs
      : state.transitionStartedAt
  const requiredDuration =
    state.phase === 'listening' ? SPEAKING_ENTER_MS : SPEAKING_EXIT_MS

  if (nowMs - transitionStartedAt < requiredDuration) {
    return { ...state, transitionStartedAt }
  }

  return {
    phase: state.phase === 'listening' ? 'speaking' : 'listening',
    transitionStartedAt: null,
  }
}
