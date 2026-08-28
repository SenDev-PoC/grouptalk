import type { GroupDisplayState } from '@/lib/group-status'
import type { ParticipationAlertState } from '@/types/domain'

/** 연결·최신성 문제가 없고 편중이 120초 지속되어 ACTIVE가 된 경우에만 권유한다. */
export function shouldShowSkewedAlert(
  statusState: GroupDisplayState,
  alertState: ParticipationAlertState,
): boolean {
  return statusState === 'skewed' && alertState === 'ACTIVE'
}
