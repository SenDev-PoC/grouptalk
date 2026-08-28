import assert from 'node:assert/strict'

import { resolveFinalStatus, resolveGroupStatus } from '../src/lib/group-status.ts'
import { shouldShowSkewedAlert } from '../src/lib/participation-alerts.ts'
import type { Group, GroupInsight } from '../src/types/domain.ts'

const NOW = Date.parse('2026-08-28T10:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

function group(patch: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    sessionId: 's1',
    name: '햇살',
    joinedAt: iso(60_000),
    currentStepId: null,
    connectionState: 'live',
    lastSeenAt: iso(2_000),
    members: [],
    ...patch,
  }
}

function insight(patch: Partial<GroupInsight> = {}): GroupInsight {
  return {
    groupId: 'g1',
    sessionId: 's1',
    participationState: 'balanced',
    participationAlertState: 'NORMAL',
    speakerShares: [],
    offTopicRatio: null,
    offTopicEvidence: [],
    summary: null,
    keywords: [],
    updatedAt: iso(3_000),
    ...patch,
  }
}

const cases: [string, string][] = [
  ['입장하지 않은 모둠은 준비 전', resolveGroupStatus(group({ joinedAt: null }), undefined, NOW).state],
  ['분석이 없으면 정보 부족', resolveGroupStatus(group(), undefined, NOW).state],
  ['고른 참여는 balanced', resolveGroupStatus(group(), insight(), NOW).state],
  [
    '편중 경향은 skewed',
    resolveGroupStatus(group(), insight({ participationState: 'skewed' }), NOW).state,
  ],
  [
    '경계 분포는 판단 불가',
    resolveGroupStatus(group(), insight({ participationState: 'unknown' }), NOW).state,
  ],
  [
    '분석이 오래되면 지난 경향 대신 갱신 중단',
    resolveGroupStatus(group(), insight({ updatedAt: iso(90_000) }), NOW).state,
  ],
  [
    '하트비트가 끊기면 연결 실패가 참여 경향보다 우선',
    resolveGroupStatus(group({ lastSeenAt: iso(60_000) }), insight(), NOW).state,
  ],
  [
    '연결 실패로 저장된 상태도 연결 실패',
    resolveGroupStatus(group({ connectionState: 'lost' }), insight(), NOW).state,
  ],
  ['사후 리포트는 최신성을 따지지 않음', resolveFinalStatus(insight({ updatedAt: iso(900_000) })).state],
  ['사후 리포트에 분석이 없으면 정보 부족', resolveFinalStatus(undefined).state],
]

const expected = [
  'not_ready',
  'insufficient',
  'balanced',
  'skewed',
  'unknown',
  'stale',
  'lost',
  'lost',
  'balanced',
  'insufficient',
]

cases.forEach(([label, actual], index) => {
  assert.equal(actual, expected[index], `${label}: ${actual} !== ${expected[index]}`)
  console.log(`  ok  ${label} → ${actual}`)
})

// 먼저 살펴볼 후보가 위로 오는지
const priorities = [
  resolveGroupStatus(group({ lastSeenAt: iso(60_000) }), insight(), NOW).priority,
  resolveGroupStatus(group(), insight({ participationState: 'skewed' }), NOW).priority,
  resolveGroupStatus(group(), insight({ participationState: 'insufficient' }), NOW).priority,
  resolveGroupStatus(group(), insight(), NOW).priority,
]
assert.ok(
  priorities[0] > priorities[1] && priorities[1] > priorities[2] && priorities[2] > priorities[3],
  `우선순위 정렬이 깨졌습니다: ${priorities.join(' > ')}`,
)
console.log(`  ok  우선 확인 정렬 연결실패 > 편중 > 정보부족 > 고른참여 (${priorities.join(' > ')})`)

assert.equal(shouldShowSkewedAlert('skewed', 'PENDING'), false)
assert.equal(shouldShowSkewedAlert('skewed', 'ACTIVE'), true)
assert.equal(shouldShowSkewedAlert('lost', 'ACTIVE'), false)
console.log('  ok  학생 참여 권유는 연결된 skewed/ACTIVE에서만 표시')

console.log('\n모든 상태 판정 검증을 통과했습니다.')
