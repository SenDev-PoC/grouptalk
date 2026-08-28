import type { GroupDisplayState } from '@/lib/group-status'
import type { ParticipationAlertState } from '@/types/domain'

/**
 * 연결·최신성 문제가 없고 백엔드 경고 상태가 ACTIVE인 동안 권유한다.
 * 참여도가 먼저 balanced로 바뀌더라도 30초 회복 검증이 끝나 NORMAL이 될 때까지 유지한다.
 */
export function shouldShowSkewedAlert(
  statusState: GroupDisplayState,
  alertState: ParticipationAlertState,
): boolean {
  const hasFreshParticipation = statusState === 'balanced' || statusState === 'skewed'
  return hasFreshParticipation && alertState === 'ACTIVE'
}
