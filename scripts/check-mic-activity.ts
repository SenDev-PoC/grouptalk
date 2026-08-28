import assert from 'node:assert/strict'

import {
  createMicActivityState,
  updateMicActivityState,
} from '../src/lib/mic-activity.ts'

let state = createMicActivityState()

state = updateMicActivityState(state, 0.1, 0)
state = updateMicActivityState(state, 0.07, 100)
state = updateMicActivityState(state, 0.11, 130)
state = updateMicActivityState(state, 0.07, 250)
assert.equal(state.phase, 'listening', '짧은 음량 피크는 말하는 중으로 바꾸지 않아야 한다')

state = updateMicActivityState(state, 0.1, 300)
state = updateMicActivityState(state, 0.1, 450)
assert.equal(state.phase, 'speaking', '150ms 동안 이어진 목소리는 말하는 중이어야 한다')

state = updateMicActivityState(state, 0.02, 500)
state = updateMicActivityState(state, 0.02, 1_050)
assert.equal(state.phase, 'speaking', '600ms보다 짧은 침묵은 말하는 중을 유지해야 한다')

state = updateMicActivityState(state, 0.2, 1_060)
state = updateMicActivityState(state, 0.02, 1_100)
state = updateMicActivityState(state, 0.02, 1_700)
assert.equal(state.phase, 'listening', '600ms 동안 이어진 침묵은 듣고 있어요로 돌아가야 한다')

console.log('  ok  짧은 음량 피크에는 듣고 있어요 유지')
console.log('  ok  150ms 연속 발화 후 말하는 중 전환')
console.log('  ok  짧은 쉼은 유지하고 600ms 침묵 후 복귀')
