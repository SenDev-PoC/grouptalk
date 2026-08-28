import type {
  Activity,
  ConnectionState,
  Group,
  GroupInsight,
  HelpRequest,
  RosterGroup,
  Session,
  SessionStatus,
  SessionSummary,
  Utterance,
} from '@/types/domain'

export interface CreateActivityInput {
  teacherId: string
  title: string
  steps: string[]
}

export interface StartSessionInput {
  teacherId: string
  activityId: string
  useRoster: boolean
}

export interface JoinGroupInput {
  sessionId: string
  groupName: string
  memberNames: string[]
  /** 재입장 시 기존 모둠을 새로 만들지 않고 이어받는다. */
  existingGroupId?: string
}

export interface RosterGroupInput {
  name: string
  students: string[]
}

/** 세션 화면이 한 번에 필요로 하는 실시간 상태 묶음. */
export interface SessionSnapshot {
  session: Session
  groups: Group[]
  insights: GroupInsight[]
  helpRequests: HelpRequest[]
}

export interface DataClient {
  readonly mode: 'supabase' | 'demo'

  listActivities(teacherId: string): Promise<Activity[]>
  createActivity(input: CreateActivityInput): Promise<Activity>
  deleteActivity(activityId: string): Promise<void>

  listSessionHistory(teacherId: string): Promise<SessionSummary[]>
  startSession(input: StartSessionInput): Promise<Session>
  getSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null>
  findSessionByJoinCode(joinCode: string): Promise<Session | null>
  setSessionStatus(sessionId: string, status: SessionStatus): Promise<void>

  joinGroup(input: JoinGroupInput): Promise<Group>
  setGroupStep(groupId: string, stepId: string | null): Promise<void>
  reportGroupPresence(groupId: string, connectionState: ConnectionState): Promise<void>

  requestHelp(sessionId: string, groupId: string): Promise<void>
  resolveHelp(helpRequestId: string): Promise<void>

  listUtterances(sessionId: string): Promise<Utterance[]>

  listRoster(teacherId: string): Promise<RosterGroup[]>
  saveRoster(teacherId: string, groups: RosterGroupInput[]): Promise<RosterGroup[]>

  /** 세션에 딸린 무엇이든 바뀌면 콜백을 호출한다. 호출부는 스냅샷을 다시 읽는다. */
  subscribeSession(sessionId: string, onChange: () => void): () => void
}
