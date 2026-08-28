import assert from 'node:assert/strict'

import {
  SESSION_SNAPSHOT_POLLING_MS,
  shouldRefreshSessionSnapshot,
  startSessionSnapshotPolling,
} from '../src/lib/session-refresh.ts'

assert.equal(shouldRefreshSessionSnapshot('SUBSCRIBED'), true)
for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'CONNECTING']) {
  assert.equal(shouldRefreshSessionSnapshot(status), false)
}

let scheduled: (() => void) | null = null
let clearedHandle: number | null = null
const scheduler = {
  setInterval(callback: () => void, delay: number) {
    assert.equal(delay, SESSION_SNAPSHOT_POLLING_MS)
    scheduled = callback
    return 11
  },
  clearInterval(handle: number) {
    clearedHandle = handle
  },
}

let refreshCount = 0
const stop = startSessionSnapshotPolling(() => {
  refreshCount += 1
}, scheduler)

assert.ok(scheduled, 'fallback polling should be scheduled')
;(scheduled as () => void)()
assert.equal(refreshCount, 1, 'polling should refresh the session snapshot')

stop()
assert.equal(clearedHandle, 11, 'polling should stop when the dashboard unmounts')

console.log('  ok  SUBSCRIBED 시 snapshot 즉시 동기화')
console.log('  ok  3초 fallback polling으로 누락된 Realtime 이벤트 복구')
console.log('  ok  화면 종료 시 polling 정리')
