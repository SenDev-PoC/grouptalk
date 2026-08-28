import type {
  Activity,
  ConnectionState,
  Group,
  GroupInsight,
  HelpRequest,
  RosterSet,
  Session,
  SessionStatus,
  SessionSummary,
  Utterance,
} from '@/types/domain'
import type {
  ClassRoom,
  FormedGroup,
  RelationshipRule,
  Student,
} from '@/types/group-formation'

export interface CreateActivityInput {
  teacherId: string
  title: string
  steps: string[]
}

export interface StartSessionInput {
  teacherId: string
  activityId: string
  useRoster: boolean
  /** useRoster가 true일 때 사용할 배정 세트 */
  rosterSetId?: string
  /** rosterSetId 대신 학급의 확정 편성(activeGroups)을 쓸 때 */
  classId?: string
}

export interface JoinGroupInput {
  joinCode: string
  sessionId: string
  groupName: string
  memberNames: string[]
  /** 재입장 시 기존 모둠을 새로 만들지 않고 이어받는다. */
  existingGroupId?: string
}

export interface JoinGroupResult {
  group: Group
  clientDeviceKey: string
}

export interface RosterGroupInput {
  name: string
  students: string[]
}

export interface RosterSetInput {
  name: string
  groups: RosterGroupInput[]
}

export interface ClassStudentInput {
  id?: string
  stuNum?: number
  name: string
  gender?: Student['gender']
  academicLevel?: Student['academicLevel']
  engagement?: Student['engagement']
}

export interface ClassRelationshipInput {
  studentAId: string
  studentBId: string
  type: RelationshipRule['type']
}

export interface UpsertClassInput {
  teacherId: string
  id?: string
  name: string
  subject?: string
  students: ClassStudentInput[]
  relationships?: ClassRelationshipInput[]
}

export interface ConfirmClassGroupsInput {
  teacherId: string
  classId: string
  groups: FormedGroup[]
}

/** 세션 화면이 한 번에 필요로 하는 실시간 상태 묶음. */
export interface SessionSnapshot {
  session: Session
  groups: Group[]
  insights: GroupInsight[]
  helpRequests: HelpRequest[]
}

export interface JoinPreview {
  session: Session
  presetGroups: Group[]
}

export interface DataClient {
  readonly mode: 'supabase' | 'demo'

  listActivities(teacherId: string): Promise<Activity[]>
  createActivity(input: CreateActivityInput): Promise<Activity>
  deleteActivity(activityId: string): Promise<void>

  listSessionHistory(teacherId: string): Promise<SessionSummary[]>
  startSession(input: StartSessionInput): Promise<Session>
  getSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null>
  getJoinPreview(joinCode: string): Promise<JoinPreview | null>
  setSessionStatus(sessionId: string, status: SessionStatus): Promise<void>

  joinGroup(input: JoinGroupInput): Promise<JoinGroupResult>
  setGroupStep(groupId: string, stepId: string | null): Promise<void>
  reportGroupPresence(
    groupId: string,
    clientDeviceKey: string,
    connectionState: ConnectionState,
  ): Promise<void>

  requestHelp(sessionId: string, groupId: string): Promise<void>
  resolveHelp(helpRequestId: string): Promise<void>

  listUtterances(sessionId: string): Promise<Utterance[]>

  listRosterSets(teacherId: string): Promise<RosterSet[]>
  saveRosterSets(teacherId: string, sets: RosterSetInput[]): Promise<RosterSet[]>

  listClasses(teacherId: string): Promise<ClassRoom[]>
  upsertClass(input: UpsertClassInput): Promise<ClassRoom>
  deleteClass(classId: string): Promise<void>
  /** 현재 편성을 확정(덮어쓰기)하고, 활동 시작용 roster_set 에도 학급명으로 동기화한다. */
  confirmClassGroups(input: ConfirmClassGroupsInput): Promise<ClassRoom>

  /** 세션에 딸린 무엇이든 바뀌면 콜백을 호출한다. 호출부는 스냅샷을 다시 읽는다. */
  subscribeSession(sessionId: string, onChange: () => void): () => void
}

export type { ClassRoom, FormedGroup }
