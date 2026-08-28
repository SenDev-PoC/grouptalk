export const SESSION_SNAPSHOT_POLLING_MS = 3_000

interface PollingScheduler {
  setInterval(callback: () => void, delay: number): number
  clearInterval(handle: number): void
}

/** 최초 조회와 구독 시작 사이의 경쟁 및 Realtime 재연결 누락을 닫는다. */
export function shouldRefreshSessionSnapshot(status: string): boolean {
  return status === 'SUBSCRIBED'
}

/** Realtime 이벤트가 누락되어도 교사 snapshot을 제한 시간 안에 복구한다. */
export function startSessionSnapshotPolling(
  refresh: () => void,
  scheduler: PollingScheduler = window,
): () => void {
  const handle = scheduler.setInterval(refresh, SESSION_SNAPSHOT_POLLING_MS)
  return () => scheduler.clearInterval(handle)
}
