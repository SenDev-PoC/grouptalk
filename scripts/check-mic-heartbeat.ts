import assert from 'node:assert/strict'

import {
  GROUP_PRESENCE_HEARTBEAT_MS,
  isMicPresenceConnected,
  startGroupPresenceHeartbeat,
  type MicPhase,
} from '../src/lib/mic-heartbeat.ts'

const connectedPhases: MicPhase[] = ['listening', 'speaking', 'muted']
const disconnectedPhases: MicPhase[] = ['idle', 'connecting', 'error']

for (const phase of connectedPhases) {
  assert.equal(isMicPresenceConnected(phase), true, `${phase} should keep one heartbeat`)
}
for (const phase of disconnectedPhases) {
  assert.equal(isMicPresenceConnected(phase), false, `${phase} should stop the heartbeat`)
}

let scheduled: (() => void) | null = null
let clearedHandle: number | null = null
const scheduler = {
  setInterval(callback: () => void, delay: number) {
    assert.equal(delay, GROUP_PRESENCE_HEARTBEAT_MS)
    scheduled = callback
    return 7
  },
  clearInterval(handle: number) {
    clearedHandle = handle
  },
}

let reportCount = 0
const stop = startGroupPresenceHeartbeat(async () => {
  reportCount += 1
}, scheduler)

assert.equal(reportCount, 1, 'connection should report presence immediately')
assert.ok(scheduled, 'heartbeat interval should be scheduled')
;(scheduled as () => void)()
assert.equal(reportCount, 2, 'scheduled heartbeat should report presence again')

stop()
assert.equal(clearedHandle, 7, 'heartbeat interval should be cleared on disconnect')

console.log('  ok  listening/speaking/muted 상태 전환은 하나의 연결로 유지')
console.log('  ok  연결 직후 및 8초 주기 heartbeat 전송')
console.log('  ok  연결 종료 시 heartbeat 정리')
