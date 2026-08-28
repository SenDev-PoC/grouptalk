import type {
  Activity,
  Group,
  GroupInsight,
  HelpRequest,
  ParticipationState,
  RosterGroup,
  Session,
  SessionSummary,
  Utterance,
} from '@/types/domain'

import type { DataClient, SessionSnapshot } from './types'

const STORAGE_KEY = 'moodumview.demo.v1'
const CHANNEL_NAME = 'moodumview.demo'

interface DemoState {
  activities: Activity[]
  sessions: Session[]
  groups: Group[]
  insights: GroupInsight[]
  helpRequests: HelpRequest[]
  utterances: Utterance[]
  roster: RosterGroup[]
}

const emptyState: DemoState = {
  activities: [],
  sessions: [],
  groups: [],
  insights: [],
  helpRequests: [],
  utterances: [],
  roster: [],
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function now() {
  return new Date().toISOString()
}

function readState(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(emptyState)
    return { ...structuredClone(emptyState), ...(JSON.parse(raw) as Partial<DemoState>) }
  } catch {
    return structuredClone(emptyState)
  }
}

function writeState(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** 데모에서 네 가지 대표 상태를 모두 보여주기 위한 모둠별 시나리오. */
type DemoScenario = 'balanced' | 'skewed' | 'insufficient' | 'lost'
const SCENARIOS: DemoScenario[] = ['balanced', 'skewed', 'insufficient', 'lost']

const SAMPLE_LINES = [
  '우리 먼저 자료부터 나눠서 읽어 볼까?',
  '나는 두 번째 근거가 제일 설득력 있다고 생각해.',
  '그 부분은 출처를 한 번 더 확인해 보자.',
  '반대 입장도 정리해 두면 발표할 때 좋을 것 같아.',
  '정리한 내용을 표로 만들어 보면 어때?',
  '시간 얼마 안 남았으니까 결론부터 맞추자.',
]
const OFF_TOPIC_LINES = ['어제 그 영상 봤어?', '점심 뭐 나와?', '주말에 뭐 할 거야?']

function generateJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
    '',
  )
}

function seedIfEmpty(state: DemoState): DemoState {
  if (state.activities.length > 0) return state
  const activityId = uid('act')
  state.activities.push({
    id: activityId,
    teacherId: 'demo-teacher',
    title: '기후 변화 대응, 우리 학교부터',
    createdAt: now(),
    steps: [
      { id: uid('stp'), position: 0, label: '자료 읽기' },
      { id: uid('stp'), position: 1, label: '의견 나누기' },
      { id: uid('stp'), position: 2, label: '결론 정리' },
    ],
  })
  state.roster = ['햇살', '나무', '바다', '구름'].map((name, index) => ({
    id: uid('rg'),
    teacherId: 'demo-teacher',
    name,
    position: index,
    students: ['가온', '나린', '다솜', '라온'].map((student) => ({
      id: uid('rs'),
      name: `${name} ${student}`,
    })),
  }))
  return state
}

export function createDemoData(): DataClient {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null

  function commit(mutate: (state: DemoState) => void) {
    const state = readState()
    mutate(state)
    writeState(state)
    channel?.postMessage({ type: 'change' })
    // BroadcastChannel은 같은 탭으로 되돌아오지 않으므로 직접 알린다.
    window.dispatchEvent(new CustomEvent('moodumview-demo-change'))
  }

  function read<T>(select: (state: DemoState) => T): T {
    const state = seedIfEmpty(readState())
    writeState(state)
    return select(state)
  }

  return {
    mode: 'demo',

    async listActivities(teacherId) {
      return read((state) =>
        state.activities
          .filter((activity) => activity.teacherId === teacherId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      )
    },

    async createActivity({ teacherId, title, steps }) {
      const activity: Activity = {
        id: uid('act'),
        teacherId,
        title,
        createdAt: now(),
        steps: steps.map((label, index) => ({ id: uid('stp'), position: index, label })),
      }
      commit((state) => void state.activities.unshift(activity))
      return activity
    },

    async deleteActivity(activityId) {
      commit((state) => {
        state.activities = state.activities.filter((activity) => activity.id !== activityId)
      })
    },

    async listSessionHistory(teacherId) {
      return read((state) =>
        state.sessions
          .filter((session) => session.teacherId === teacherId && session.status === 'ended')
          .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
          .map(
            (session): SessionSummary => ({
              id: session.id,
              title: session.title,
              joinCode: session.joinCode,
              status: session.status,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              groupCount: state.groups.filter((group) => group.sessionId === session.id).length,
            }),
          ),
      )
    },

    async startSession({ teacherId, activityId, useRoster }) {
      const state = seedIfEmpty(readState())
      const activity = state.activities.find((item) => item.id === activityId)
      if (!activity) throw new Error('활동을 찾을 수 없습니다.')

      const session: Session = {
        id: uid('ses'),
        activityId,
        teacherId,
        title: activity.title,
        joinCode: generateJoinCode(),
        status: 'waiting',
        useRoster,
        createdAt: now(),
        startedAt: null,
        endedAt: null,
        steps: activity.steps.map((step) => ({ ...step, id: uid('stp') })),
      }

      commit((draft) => {
        draft.sessions.push(session)
        if (useRoster) {
          for (const rosterGroup of draft.roster) {
            draft.groups.push({
              id: uid('grp'),
              sessionId: session.id,
              name: rosterGroup.name,
              joinedAt: null,
              currentStepId: null,
              connectionState: 'not_ready',
              lastSeenAt: null,
              members: rosterGroup.students.map((student) => ({
                id: uid('mem'),
                name: student.name,
              })),
            })
          }
        }
      })

      return session
    },

    async getSessionSnapshot(sessionId) {
      return read((state) => {
        const session = state.sessions.find((item) => item.id === sessionId)
        if (!session) return null
        return {
          session,
          groups: state.groups
            .filter((group) => group.sessionId === sessionId)
            .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
          insights: state.insights.filter((insight) => insight.sessionId === sessionId),
          helpRequests: state.helpRequests
            .filter((request) => request.sessionId === sessionId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        } satisfies SessionSnapshot
      })
    },

    async findSessionByJoinCode(joinCode) {
      return read(
        (state) =>
          state.sessions.find(
            (session) => session.joinCode === joinCode.toUpperCase(),
          ) ?? null,
      )
    },

    async setSessionStatus(sessionId, status) {
      commit((state) => {
        const session = state.sessions.find((item) => item.id === sessionId)
        if (!session) return
        session.status = status
        if (status === 'active') session.startedAt = now()
        if (status === 'ended') session.endedAt = now()
      })
    },

    async joinGroup({ sessionId, groupName, memberNames, existingGroupId }) {
      let result: Group | null = null
      commit((state) => {
        const timestamp = now()
        const members = memberNames.map((name) => ({ id: uid('mem'), name }))
        const target =
          state.groups.find((group) => group.id === existingGroupId) ??
          state.groups.find(
            (group) =>
              group.sessionId === sessionId && group.name === groupName && group.joinedAt === null,
          )

        if (target) {
          target.name = groupName
          target.joinedAt = timestamp
          target.lastSeenAt = timestamp
          target.members = members
          result = target
          return
        }

        const created: Group = {
          id: uid('grp'),
          sessionId,
          name: groupName,
          joinedAt: timestamp,
          currentStepId: null,
          connectionState: 'not_ready',
          lastSeenAt: timestamp,
          members,
        }
        state.groups.push(created)
        result = created
      })
      if (!result) throw new Error('모둠 입장에 실패했습니다.')
      return result
    },

    async setGroupStep(groupId, stepId) {
      commit((state) => {
        const group = state.groups.find((item) => item.id === groupId)
        if (group) group.currentStepId = stepId
      })
    },

    async reportGroupPresence(groupId, connectionState) {
      commit((state) => {
        const group = state.groups.find((item) => item.id === groupId)
        if (!group) return
        group.connectionState = connectionState
        group.lastSeenAt = now()
      })
    },

    async requestHelp(sessionId, groupId) {
      commit((state) => {
        const alreadyOpen = state.helpRequests.some(
          (request) => request.groupId === groupId && request.resolvedAt === null,
        )
        if (alreadyOpen) return
        state.helpRequests.push({
          id: uid('help'),
          sessionId,
          groupId,
          createdAt: now(),
          resolvedAt: null,
        })
      })
    },

    async resolveHelp(helpRequestId) {
      commit((state) => {
        const request = state.helpRequests.find((item) => item.id === helpRequestId)
        if (request) request.resolvedAt = now()
      })
    },

    async listUtterances(sessionId) {
      return read((state) =>
        state.utterances
          .filter((utterance) => utterance.sessionId === sessionId)
          .sort((a, b) => a.spokenAt.localeCompare(b.spokenAt)),
      )
    },

    async listRoster(teacherId) {
      return read((state) => state.roster.filter((group) => group.teacherId === teacherId))
    },

    async saveRoster(teacherId, groups) {
      const next: RosterGroup[] = groups.map((group, index) => ({
        id: uid('rg'),
        teacherId,
        name: group.name,
        position: index,
        students: group.students.map((name) => ({ id: uid('rs'), name })),
      }))
      commit((state) => {
        state.roster = [
          ...state.roster.filter((group) => group.teacherId !== teacherId),
          ...next,
        ]
      })
      return next
    },

    subscribeSession(_sessionId, onChange) {
      const handler = () => onChange()
      channel?.addEventListener('message', handler)
      window.addEventListener('moodumview-demo-change', handler)
      window.addEventListener('storage', handler)
      return () => {
        channel?.removeEventListener('message', handler)
        window.removeEventListener('moodumview-demo-change', handler)
        window.removeEventListener('storage', handler)
      }
    },
  }
}

/**
 * 데모 전용 합성 분석 루프. 백엔드(Deepgram + LLM)가 붙기 전까지 대시보드가
 * 무엇을 보여줄지 확인하기 위한 것이며, 실시간 분석 결과인 척하지 않는다.
 */
export function startDemoAnalysis(sessionId: string) {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null

  const tick = () => {
    const state = readState()
    const session = state.sessions.find((item) => item.id === sessionId)
    if (!session || session.status !== 'active') return

    const groups = state.groups.filter(
      (group) => group.sessionId === sessionId && group.joinedAt !== null,
    )
    const elapsedMs = session.startedAt ? Date.now() - new Date(session.startedAt).getTime() : 0

    groups.forEach((group, index) => {
      const scenario = SCENARIOS[index % SCENARIOS.length]

      if (scenario === 'lost') {
        // 연결 실패 모둠은 새 분석을 만들지 않는다. 참여 문제와 구분되어야 한다.
        if (elapsedMs > 25_000) group.connectionState = 'lost'
        return
      }

      if (scenario !== 'insufficient' || elapsedMs > 60_000) {
        const line =
          Math.random() < 0.18
            ? OFF_TOPIC_LINES[Math.floor(Math.random() * OFF_TOPIC_LINES.length)]
            : SAMPLE_LINES[Math.floor(Math.random() * SAMPLE_LINES.length)]
        const speakerLabel =
          scenario === 'skewed' && Math.random() < 0.7
            ? '화자 A'
            : ['화자 A', '화자 B', '화자 C'][Math.floor(Math.random() * 3)]
        state.utterances.push({
          id: uid('utt'),
          sessionId,
          groupId: group.id,
          speakerLabel,
          text: line,
          spokenAt: now(),
        })
      }

      const totals = new Map<string, number>()
      for (const utterance of state.utterances) {
        if (utterance.groupId !== group.id) continue
        totals.set(utterance.speakerLabel, (totals.get(utterance.speakerLabel) ?? 0) + 1)
      }
      const totalCount = [...totals.values()].reduce((sum, value) => sum + value, 0)

      let participationState: ParticipationState = 'insufficient'
      if (totalCount >= 8) participationState = scenario === 'skewed' ? 'skewed' : 'balanced'

      const offTopic = state.utterances.filter(
        (item) => item.groupId === group.id && OFF_TOPIC_LINES.includes(item.text),
      )

      const insight: GroupInsight = {
        groupId: group.id,
        sessionId,
        participationState,
        speakerShares: [...totals.entries()]
          .map(([speakerLabel, count]) => ({
            speakerLabel,
            ratio: totalCount === 0 ? 0 : count / totalCount,
            utteranceCount: count,
          }))
          .sort((a, b) => b.ratio - a.ratio),
        offTopicRatio: totalCount === 0 ? null : offTopic.length / totalCount,
        offTopicEvidence: offTopic.slice(-2).map((item) => ({
          quote: item.text,
          reason: '활동 주제와 직접 연결되는 내용을 찾지 못했습니다.',
          at: item.spokenAt,
        })),
        summary:
          totalCount < 8
            ? null
            : scenario === 'skewed'
              ? '한 화자가 대부분의 발화를 이어가고 나머지 화자의 참여가 적습니다.'
              : '여러 화자가 번갈아 근거를 제시하며 결론을 좁혀가고 있습니다.',
        keywords: totalCount < 8 ? [] : ['근거', '출처 확인', '결론 정리'],
        updatedAt: now(),
      }

      const existingIndex = state.insights.findIndex((item) => item.groupId === group.id)
      if (existingIndex >= 0) state.insights[existingIndex] = insight
      else state.insights.push(insight)
    })

    writeState(state)
    window.dispatchEvent(new CustomEvent('moodumview-demo-change'))
    channel?.postMessage({ type: 'change' })
  }

  const timer = window.setInterval(tick, 3000)
  tick()
  return () => {
    window.clearInterval(timer)
    channel?.close()
  }
}
