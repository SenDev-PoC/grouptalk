import type { GroupDisplayState } from '@/lib/group-status'

/** 근거가 충분하고 편중으로 판정된 경우에만 학생 참여 권유를 표시한다. */
export function shouldShowSkewedAlert(statusState: GroupDisplayState): boolean {
  return statusState === 'skewed'
}
