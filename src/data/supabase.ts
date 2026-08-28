import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { env } from '@/lib/env'
import { shouldRefreshSessionSnapshot } from '@/lib/session-refresh'
import type {
  Activity,
  ActivityStep,
  ConnectionState,
  Group,
  GroupInsight,
  HelpRequest,
  ParticipationState,
  RosterSet,
  Session,
  SessionStatus,
  SessionSummary,
  Utterance,
} from '@/types/domain'
import type {
  AcademicLevel,
  ClassRoom,
  EngagementLevel,
  FormedGroup,
  Gender,
  RelationshipRule,
  Student,
} from '@/types/group-formation'

import type { DataClient, SessionSnapshot } from './types'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  }
  return client
}

type Row = Record<string, unknown>

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toStep(row: Row): ActivityStep {
  return { id: str(row.id), position: num(row.position), label: str(row.label) }
}

function byPosition(a: { position: number }, b: { position: number }) {
  return a.position - b.position
}

function toSession(row: Row, steps: ActivityStep[]): Session {
  const status = str(row.status, 'waiting')
  return {
    id: str(row.id),
    activityId: str(row.activity_id),
    teacherId: str(row.teacher_id),
    title: str(row.title),
    joinCode: str(row.join_code),
    status: (['waiting', 'active', 'ended'].includes(status) ? status : 'waiting') as SessionStatus,
    useRoster: row.use_roster === true,
    createdAt: str(row.created_at),
    startedAt: nullableStr(row.started_at),
    endedAt: nullableStr(row.ended_at),
    steps: [...steps].sort(byPosition),
  }
}

function toGroup(row: Row, members: { id: string; name: string; position: number }[]): Group {
  const connection = str(row.connection_state, 'not_ready')
  return {
    id: str(row.id),
    sessionId: str(row.session_id),
    name: str(row.name),
    joinedAt: nullableStr(row.joined_at),
    currentStepId: nullableStr(row.current_step_id),
    connectionState: (['not_ready', 'connecting', 'live', 'lost'].includes(connection)
      ? connection
      : 'not_ready') as ConnectionState,
    lastSeenAt: nullableStr(row.last_seen_at),
    members: [...members].sort(byPosition).map(({ id, name }) => ({ id, name })),
  }
}

function toInsight(row: Row): GroupInsight {
  const participation = str(row.participation_state, 'insufficient')
  const shares = Array.isArray(row.speaker_shares) ? (row.speaker_shares as Row[]) : []
  const evidence = Array.isArray(row.off_topic_evidence) ? (row.off_topic_evidence as Row[]) : []
  return {
    groupId: str(row.group_id),
    sessionId: str(row.session_id),
    participationState: (['balanced', 'skewed', 'insufficient', 'unknown'].includes(participation)
      ? participation
      : 'unknown') as ParticipationState,
    participationAlertState: (['NORMAL', 'PENDING', 'ACTIVE'].includes(
      str(row.participation_alert_state),
    )
      ? str(row.participation_alert_state)
      : 'NORMAL') as GroupInsight['participationAlertState'],
    speakerShares: shares.map((share) => ({
      speakerLabel: str(share.speaker_label, '화자'),
      ratio: num(share.ratio),
      utteranceCount: num(share.utterance_count),
      speakingTimeMs: num(share.speaking_time_ms),
    })),
    offTopicRatio: typeof row.off_topic_ratio === 'number' ? row.off_topic_ratio : null,
    offTopicEvidence: evidence.map((item) => ({
      quote: str(item.quote),
      reason: str(item.reason),
      at: nullableStr(item.at),
    })),
    summary: nullableStr(row.summary),
    keywords: Array.isArray(row.keywords) ? row.keywords.map((k) => String(k)) : [],
    updatedAt: nullableStr(row.updated_at),
  }
}

function asGender(value: unknown): Gender | null {
  return value === 'M' || value === 'F' ? value : null
}

function asAcademic(value: unknown): AcademicLevel | null {
  return value === 'high' || value === 'mid' || value === 'low' ? value : null
}

function asEngagement(value: unknown): EngagementLevel | null {
  return value === 'active' || value === 'moderate' || value === 'passive' ? value : null
}

function mapClassRow(row: Row): ClassRoom {
  const students: Student[] = ((row.class_students as Row[] | undefined) ?? [])
    .map((student) => ({
      id: str(student.id),
      stuNum: typeof student.stu_num === 'number' ? student.stu_num : undefined,
      name: str(student.name),
      gender: asGender(student.gender),
      academicLevel: asAcademic(student.academic_level),
      engagement: asEngagement(student.engagement),
      position: num(student.position),
    }))
    .sort(byPosition)
    .map(({ position: _p, ...student }) => student)

  const studentById = new Map(students.map((student) => [student.id, student]))

  const relationships: RelationshipRule[] = (
    (row.class_relationship_rules as Row[] | undefined) ?? []
  ).map((rule) => ({
    id: str(rule.id),
    studentAId: str(rule.student_a_id),
    studentBId: str(rule.student_b_id),
    type: (['mustSeparate', 'mustTogether', 'preferTogether'].includes(str(rule.rule_type))
      ? str(rule.rule_type)
      : 'mustSeparate') as RelationshipRule['type'],
  }))

  const formedGroups = ((row.class_formed_groups as Row[] | undefined) ?? [])
    .slice()
    .sort((a, b) => num(a.position) - num(b.position))
    .map((group, index) => {
      const members = ((group.class_formed_group_members as Row[] | undefined) ?? [])
        .slice()
        .sort((a, b) => num(a.position) - num(b.position))
        .map((member) => studentById.get(str(member.class_student_id)))
        .filter((member): member is Student => Boolean(member))

      return {
        groupId: index + 1,
        groupName: str(group.group_name),
        members,
      } satisfies FormedGroup
    })

  return {
    id: str(row.id),
    name: str(row.name),
    subject: nullableStr(row.subject) ?? undefined,
    students,
    relationships,
    activeGroups: formedGroups.length > 0 ? formedGroups : null,
  }
}

function generateJoinCode() {
  // 사람이 받아 적는 코드라 0/O, 1/I 처럼 헷갈리는 글자는 뺀다.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const buffer = new Uint32Array(6)
  crypto.getRandomValues(buffer)
  for (const value of buffer) code += alphabet[value % alphabet.length]
  return code
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('데이터를 불러오지 못했습니다.')
  return result.data
}

export function createSupabaseData(): DataClient {
  const db = getSupabase()

  async function fetchSteps(sessionIds: string[]) {
    if (sessionIds.length === 0) return new Map<string, ActivityStep[]>()
    const rows = unwrap(
      await db.from('session_steps').select('*').in('session_id', sessionIds),
    ) as Row[]
    const map = new Map<string, ActivityStep[]>()
    for (const row of rows) {
      const key = str(row.session_id)
      const list = map.get(key) ?? []
      list.push(toStep(row))
      map.set(key, list)
    }
    return map
  }

  async function loadSession(row: Row): Promise<Session> {
    const steps = await fetchSteps([str(row.id)])
    return toSession(row, steps.get(str(row.id)) ?? [])
  }

  return {
    mode: 'supabase',

    async listActivities(teacherId) {
      const activityRows = unwrap(
        await db
          .from('activities')
          .select('*')
          .eq('teacher_id', teacherId)
          .order('created_at', { ascending: false }),
      ) as Row[]
      if (activityRows.length === 0) return []

      const stepRows = unwrap(
        await db
          .from('activity_steps')
          .select('*')
          .in('activity_id', activityRows.map((row) => str(row.id))),
      ) as Row[]

      return activityRows.map((row) => ({
        id: str(row.id),
        teacherId: str(row.teacher_id),
        title: str(row.title),
        createdAt: str(row.created_at),
        steps: stepRows
          .filter((step) => str(step.activity_id) === str(row.id))
          .map(toStep)
          .sort(byPosition),
      })) satisfies Activity[]
    },

    async createActivity({ teacherId, title, steps }) {
      const activity = unwrap(
        await db
          .from('activities')
          .insert({ teacher_id: teacherId, title })
          .select()
          .single(),
      ) as Row

      const stepRows = unwrap(
        await db
          .from('activity_steps')
          .insert(
            steps.map((label, index) => ({
              activity_id: str(activity.id),
              position: index,
              label,
            })),
          )
          .select(),
      ) as Row[]

      return {
        id: str(activity.id),
        teacherId,
        title,
        createdAt: str(activity.created_at),
        steps: stepRows.map(toStep).sort(byPosition),
      }
    },

    async deleteActivity(activityId) {
      const { error } = await db.from('activities').delete().eq('id', activityId)
      if (error) throw new Error(error.message)
    },

    async listSessionHistory(teacherId) {
      const rows = unwrap(
        await db
          .from('sessions')
          .select('*, groups(count)')
          .eq('teacher_id', teacherId)
          .eq('status', 'ended')
          .order('ended_at', { ascending: false }),
      ) as Row[]

      return rows.map((row) => {
        const counts = row.groups as { count: number }[] | undefined
        return {
          id: str(row.id),
          title: str(row.title),
          joinCode: str(row.join_code),
          status: 'ended',
          startedAt: nullableStr(row.started_at),
          endedAt: nullableStr(row.ended_at),
          groupCount: counts?.[0]?.count ?? 0,
        }
      }) satisfies SessionSummary[]
    },

    async startSession({ teacherId, activityId, useRoster, rosterSetId, classId }) {
      const activity = unwrap(
        await db.from('activities').select('*').eq('id', activityId).single(),
      ) as Row
      const activitySteps = unwrap(
        await db.from('activity_steps').select('*').eq('activity_id', activityId),
      ) as Row[]

      let sessionRow: Row | null = null
      let lastError: unknown = null
      for (let attempt = 0; attempt < 5 && !sessionRow; attempt += 1) {
        const result = await db
          .from('sessions')
          .insert({
            activity_id: activityId,
            teacher_id: teacherId,
            title: str(activity.title),
            join_code: generateJoinCode(),
            status: 'waiting',
            use_roster: useRoster,
          })
          .select()
          .single()
        if (result.error) lastError = result.error
        else sessionRow = result.data as Row
      }
      if (!sessionRow) {
        throw new Error(
          lastError instanceof Error ? lastError.message : '세션을 만들지 못했습니다.',
        )
      }

      const sessionId = str(sessionRow.id)
      const steps = unwrap(
        await db
          .from('session_steps')
          .insert(
            activitySteps
              .map(toStep)
              .sort(byPosition)
              .map((step) => ({ session_id: sessionId, position: step.position, label: step.label })),
          )
          .select(),
      ) as Row[]

      type PresetGroup = { name: string; students: { name: string; position: number }[] }
      let presetGroups: PresetGroup[] = []

      if (useRoster && classId) {
        const classes = await this.listClasses(teacherId)
        const classroom = classes.find((item) => item.id === classId)
        presetGroups = (classroom?.activeGroups ?? []).map((group) => ({
          name: group.groupName,
          students: group.members.map((member, index) => ({
            name: member.name,
            position: index,
          })),
        }))
      } else if (useRoster && rosterSetId) {
        const rosterGroups = unwrap(
          await db
            .from('roster_groups')
            .select('*, roster_students(*)')
            .eq('roster_set_id', rosterSetId)
            .eq('teacher_id', teacherId)
            .order('position'),
        ) as Row[]

        presetGroups = rosterGroups.map((rosterGroup) => ({
          name: str(rosterGroup.name),
          students: ((rosterGroup.roster_students as Row[] | undefined) ?? [])
            .map((student) => ({
              name: str(student.name),
              position: num(student.position),
            }))
            .sort(byPosition),
        }))
      }

      for (const preset of presetGroups) {
        const group = unwrap(
          await db
            .from('groups')
            .insert({
              session_id: sessionId,
              name: preset.name,
              connection_state: 'not_ready',
            })
            .select()
            .single(),
        ) as Row
        if (preset.students.length === 0) continue
        const { error } = await db.from('group_members').insert(
          preset.students.map((student, index) => ({
            group_id: str(group.id),
            name: student.name,
            position: index,
          })),
        )
        if (error) throw new Error(error.message)
      }

      return toSession(sessionRow, steps.map(toStep))
    },

    async getSessionSnapshot(sessionId) {
      const sessionResult = await db.from('sessions').select('*').eq('id', sessionId).maybeSingle()
      if (sessionResult.error) throw new Error(sessionResult.error.message)
      if (!sessionResult.data) return null

      const session = await loadSession(sessionResult.data as Row)

      const [groupRows, memberRows, insightRows, helpRows] = await Promise.all([
        db.from('groups').select('*').eq('session_id', sessionId).order('name'),
        db.from('group_members').select('*'),
        db.from('group_insights').select('*').eq('session_id', sessionId),
        db
          .from('help_requests')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true }),
      ])

      const groups = (unwrap(groupRows) as Row[]).map((row) => {
        const members = (unwrap(memberRows) as Row[])
          .filter((member) => str(member.group_id) === str(row.id))
          .map((member) => ({
            id: str(member.id),
            name: str(member.name),
            position: num(member.position),
          }))
        return toGroup(row, members)
      })

      const helpRequests = (unwrap(helpRows) as Row[]).map((row) => ({
        id: str(row.id),
        sessionId: str(row.session_id),
        groupId: str(row.group_id),
        createdAt: str(row.created_at),
        resolvedAt: nullableStr(row.resolved_at),
      })) satisfies HelpRequest[]

      return {
        session,
        groups,
        insights: (unwrap(insightRows) as Row[]).map(toInsight),
        helpRequests,
      } satisfies SessionSnapshot
    },

    async findSessionByJoinCode(joinCode) {
      const result = await db
        .from('sessions')
        .select('*')
        .eq('join_code', joinCode.toUpperCase())
        .maybeSingle()
      if (result.error) throw new Error(result.error.message)
      if (!result.data) return null
      return loadSession(result.data as Row)
    },

    async setSessionStatus(sessionId, status) {
      const patch: Row = { status }
      if (status === 'active') patch.started_at = new Date().toISOString()
      if (status === 'ended') patch.ended_at = new Date().toISOString()
      const { error } = await db.from('sessions').update(patch).eq('id', sessionId)
      if (error) throw new Error(error.message)
    },

    async joinGroup({ sessionId, groupName, memberNames, existingGroupId }) {
      const now = new Date().toISOString()
      const sessionRow = unwrap(
        await db.from('sessions').select('use_roster').eq('id', sessionId).single(),
      ) as Row
      const lockMembers = sessionRow.use_roster === true

      async function loadMembers(groupId: string) {
        const rows = unwrap(
          await db.from('group_members').select('*').eq('group_id', groupId),
        ) as Row[]
        return rows.map((row) => ({
          id: str(row.id),
          name: str(row.name),
          position: num(row.position),
        }))
      }

      if (lockMembers) {
        let groupRow: Row
        if (existingGroupId) {
          groupRow = unwrap(
            await db
              .from('groups')
              .update({ joined_at: now, last_seen_at: now })
              .eq('id', existingGroupId)
              .eq('session_id', sessionId)
              .select()
              .single(),
          ) as Row
        } else {
          const preset = await db
            .from('groups')
            .select('*')
            .eq('session_id', sessionId)
            .eq('name', groupName)
            .maybeSingle()
          if (preset.error) throw new Error(preset.error.message)
          if (!preset.data) throw new Error('미리 배정된 모둠만 입장할 수 있습니다.')
          groupRow = unwrap(
            await db
              .from('groups')
              .update({ joined_at: now, last_seen_at: now })
              .eq('id', str((preset.data as Row).id))
              .select()
              .single(),
          ) as Row
        }
        return toGroup(groupRow, await loadMembers(str(groupRow.id)))
      }

      let groupRow: Row

      if (existingGroupId) {
        groupRow = unwrap(
          await db
            .from('groups')
            .update({ name: groupName, joined_at: now, last_seen_at: now })
            .eq('id', existingGroupId)
            .select()
            .single(),
        ) as Row
        const { error } = await db.from('group_members').delete().eq('group_id', existingGroupId)
        if (error) throw new Error(error.message)
      } else {
        const preset = await db
          .from('groups')
          .select('*')
          .eq('session_id', sessionId)
          .eq('name', groupName)
          .is('joined_at', null)
          .maybeSingle()
        if (preset.error) throw new Error(preset.error.message)

        if (preset.data) {
          groupRow = unwrap(
            await db
              .from('groups')
              .update({ joined_at: now, last_seen_at: now })
              .eq('id', str((preset.data as Row).id))
              .select()
              .single(),
          ) as Row
          const { error } = await db
            .from('group_members')
            .delete()
            .eq('group_id', str(groupRow.id))
          if (error) throw new Error(error.message)
        } else {
          groupRow = unwrap(
            await db
              .from('groups')
              .insert({
                session_id: sessionId,
                name: groupName,
                joined_at: now,
                last_seen_at: now,
                connection_state: 'not_ready',
              })
              .select()
              .single(),
          ) as Row
        }
      }

      const memberRows = unwrap(
        await db
          .from('group_members')
          .insert(
            memberNames.map((name, index) => ({
              group_id: str(groupRow.id),
              name,
              position: index,
            })),
          )
          .select(),
      ) as Row[]

      return toGroup(
        groupRow,
        memberRows.map((row) => ({
          id: str(row.id),
          name: str(row.name),
          position: num(row.position),
        })),
      )
    },

    async setGroupStep(groupId, stepId) {
      const { error } = await db
        .from('groups')
        .update({ current_step_id: stepId })
        .eq('id', groupId)
      if (error) throw new Error(error.message)
    },

    async reportGroupPresence(groupId, connectionState) {
      const { error } = await db.rpc('report_group_presence', {
        requested_group_id: groupId,
        requested_connection_state: connectionState,
      })
      if (error) throw new Error(error.message)
    },

    async requestHelp(sessionId, groupId) {
      const { error } = await db
        .from('help_requests')
        .insert({ session_id: sessionId, group_id: groupId })
      if (error) throw new Error(error.message)
    },

    async resolveHelp(helpRequestId) {
      const { error } = await db
        .from('help_requests')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', helpRequestId)
      if (error) throw new Error(error.message)
    },

    async listUtterances(sessionId) {
      const rows = unwrap(
        await db
          .from('utterances')
          .select('*')
          .eq('session_id', sessionId)
          .order('spoken_at', { ascending: true }),
      ) as Row[]
      return rows.map((row) => ({
        id: str(row.id),
        sessionId: str(row.session_id),
        groupId: str(row.group_id),
        speakerLabel: str(row.speaker_label, '화자'),
        text: str(row.text),
        spokenAt: str(row.spoken_at),
      })) satisfies Utterance[]
    },

    async listRosterSets(teacherId) {
      const result = await db
        .from('roster_sets')
        .select('*, roster_groups(*, roster_students(*))')
        .eq('teacher_id', teacherId)
        .order('position')

      if (result.error) {
        // roster_sets 미적용 DB에서도 학급 확정 편성 흐름은 깨지지 않게 한다.
        console.warn('[listRosterSets]', result.error.message)
        return []
      }

      const sets = (result.data ?? []) as Row[]

      return sets.map((set, setIndex) => {
        const groups = ((set.roster_groups as Row[] | undefined) ?? [])
          .map((row) => ({
            id: str(row.id),
            name: str(row.name),
            position: num(row.position),
            students: ((row.roster_students as Row[] | undefined) ?? [])
              .map((student) => ({
                id: str(student.id),
                name: str(student.name),
                position: num(student.position),
              }))
              .sort(byPosition)
              .map(({ id, name }) => ({ id, name })),
          }))
          .sort(byPosition)

        return {
          id: str(set.id),
          teacherId,
          name: str(set.name),
          position: num(set.position) || setIndex,
          groups,
        } satisfies RosterSet
      })
    },

    async saveRosterSets(teacherId, sets) {
      const existingResult = await db.from('roster_sets').select('id').eq('teacher_id', teacherId)
      if (existingResult.error) {
        console.warn('[saveRosterSets]', existingResult.error.message)
        return []
      }

      const existing = (existingResult.data ?? []) as Row[]
      if (existing.length > 0) {
        const { error } = await db
          .from('roster_sets')
          .delete()
          .in(
            'id',
            existing.map((row) => str(row.id)),
          )
        if (error) {
          console.warn('[saveRosterSets]', error.message)
          return []
        }
      }

      if (sets.length === 0) return []

      for (const [setIndex, set] of sets.entries()) {
        const setResult = await db
          .from('roster_sets')
          .insert({
            teacher_id: teacherId,
            name: set.name,
            position: setIndex,
          })
          .select()
          .single()
        if (setResult.error) {
          console.warn('[saveRosterSets]', setResult.error.message)
          return []
        }
        const setRow = setResult.data as Row

        if (set.groups.length === 0) continue

        const groupsResult = await db
          .from('roster_groups')
          .insert(
            set.groups.map((group, index) => ({
              roster_set_id: str(setRow.id),
              teacher_id: teacherId,
              name: group.name,
              position: index,
            })),
          )
          .select()
        if (groupsResult.error) {
          console.warn('[saveRosterSets]', groupsResult.error.message)
          return []
        }
        const insertedGroups = (groupsResult.data ?? []) as Row[]

        const studentRows = insertedGroups.flatMap((row, index) =>
          (set.groups[index]?.students ?? []).map((name, studentIndex) => ({
            roster_group_id: str(row.id),
            name,
            position: studentIndex,
          })),
        )
        if (studentRows.length > 0) {
          const result = await db.from('roster_students').insert(studentRows)
          if (result.error) {
            console.warn('[saveRosterSets]', result.error.message)
            return []
          }
        }
      }

      return this.listRosterSets(teacherId)
    },

    async listClasses(teacherId) {
      const rows = unwrap(
        await db
          .from('classes')
          .select(
            `*,
            class_students(*),
            class_relationship_rules(*),
            class_formed_groups(
              *,
              class_formed_group_members(*)
            )`,
          )
          .eq('teacher_id', teacherId)
          .order('position'),
      ) as Row[]

      return rows.map((row) => mapClassRow(row))
    },

    async upsertClass({ teacherId, id, name, subject, students, relationships = [] }) {
      let classId = id
      if (classId) {
        unwrap(
          await db
            .from('classes')
            .update({
              name,
              subject: subject ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', classId)
            .eq('teacher_id', teacherId)
            .select()
            .single(),
        )
      } else {
        const inserted = unwrap(
          await db
            .from('classes')
            .insert({
              teacher_id: teacherId,
              name,
              subject: subject ?? null,
              position: 0,
            })
            .select()
            .single(),
        ) as Row
        classId = str(inserted.id)
      }

      const existingStudents = unwrap(
        await db.from('class_students').select('id').eq('class_id', classId),
      ) as Row[]
      const existingIds = new Set(existingStudents.map((row) => str(row.id)))
      const keepIds = new Set<string>()
      const idMap = new Map<string, string>()

      for (const [index, student] of students.entries()) {
        const payload = {
          class_id: classId,
          stu_num: student.stuNum ?? index + 1,
          name: student.name,
          gender: student.gender ?? null,
          academic_level: student.academicLevel ?? null,
          engagement: student.engagement ?? null,
          position: index,
        }

        if (student.id && existingIds.has(student.id)) {
          unwrap(
            await db.from('class_students').update(payload).eq('id', student.id).select().single(),
          )
          keepIds.add(student.id)
          idMap.set(student.id, student.id)
        } else {
          const row = unwrap(
            await db.from('class_students').insert(payload).select().single(),
          ) as Row
          const newId = str(row.id)
          keepIds.add(newId)
          if (student.id) idMap.set(student.id, newId)
        }
      }

      const removedIds = [...existingIds].filter((studentId) => !keepIds.has(studentId))
      if (removedIds.length > 0) {
        const { error } = await db.from('class_students').delete().in('id', removedIds)
        if (error) throw new Error(error.message)
      }

      // 멤버가 모두 빠진 빈 확정 조는 정리
      const formed = unwrap(
        await db
          .from('class_formed_groups')
          .select('id, class_formed_group_members(id)')
          .eq('class_id', classId),
      ) as Row[]
      const emptyGroupIds = formed
        .filter((group) => ((group.class_formed_group_members as Row[] | undefined) ?? []).length === 0)
        .map((group) => str(group.id))
      if (emptyGroupIds.length > 0) {
        const { error } = await db.from('class_formed_groups').delete().in('id', emptyGroupIds)
        if (error) throw new Error(error.message)
      }

      const { error: clearRulesError } = await db
        .from('class_relationship_rules')
        .delete()
        .eq('class_id', classId)
      if (clearRulesError) throw new Error(clearRulesError.message)

      if (relationships.length > 0) {
        const ruleRows = relationships
          .map((rule) => ({
            class_id: classId,
            student_a_id: idMap.get(rule.studentAId) ?? rule.studentAId,
            student_b_id: idMap.get(rule.studentBId) ?? rule.studentBId,
            rule_type: rule.type,
          }))
          .filter((rule) => keepIds.has(rule.student_a_id) && keepIds.has(rule.student_b_id))

        if (ruleRows.length > 0) {
          const { error } = await db.from('class_relationship_rules').insert(ruleRows)
          if (error) throw new Error(error.message)
        }
      }

      const classes = await this.listClasses(teacherId)
      const found = classes.find((item) => item.id === classId)
      if (!found) throw new Error('학급을 저장하지 못했습니다.')
      return found
    },

    async deleteClass(classId) {
      const classRow = await db.from('classes').select('name, teacher_id').eq('id', classId).maybeSingle()
      const { error } = await db.from('classes').delete().eq('id', classId)
      if (error) throw new Error(error.message)

      const teacherId = classRow.data ? str((classRow.data as Row).teacher_id) : ''
      const className = classRow.data ? str((classRow.data as Row).name) : ''
      if (!teacherId || !className) return
      try {
        const existingSets = await this.listRosterSets(teacherId)
        const nextSets = existingSets
          .filter((set) => set.name !== className)
          .map((set) => ({
            name: set.name,
            groups: set.groups.map((group) => ({
              name: group.name,
              students: group.students.map((student) => student.name),
            })),
          }))
        if (nextSets.length !== existingSets.length) {
          await this.saveRosterSets(teacherId, nextSets)
        }
      } catch (error) {
        console.warn('[deleteClass] roster cleanup skipped', error)
      }
    },

    async confirmClassGroups({ teacherId, classId, groups }) {
      const { error: clearError } = await db.from('class_formed_groups').delete().eq('class_id', classId)
      if (clearError) throw new Error(clearError.message)

      for (const [index, group] of groups.entries()) {
        const groupRow = unwrap(
          await db
            .from('class_formed_groups')
            .insert({
              class_id: classId,
              group_name: group.groupName,
              position: index,
            })
            .select()
            .single(),
        ) as Row

        if (group.members.length === 0) continue
        const { error } = await db.from('class_formed_group_members').insert(
          group.members.map((member, memberIndex) => ({
            formed_group_id: str(groupRow.id),
            class_student_id: member.id,
            position: memberIndex,
          })),
        )
        if (error) throw new Error(error.message)
      }

      const classRow = unwrap(
        await db.from('classes').select('name').eq('id', classId).single(),
      ) as Row
      const rosterName = str(classRow.name)

      try {
        const existingSets = await this.listRosterSets(teacherId)
        const nextSets = [
          ...existingSets
            .filter((set) => set.name !== rosterName)
            .map((set) => ({
              name: set.name,
              groups: set.groups.map((group) => ({
                name: group.name,
                students: group.students.map((student) => student.name),
              })),
            })),
          {
            name: rosterName,
            groups: groups.map((group) => ({
              name: group.groupName,
              students: group.members.map((member) => member.name),
            })),
          },
        ]
        await this.saveRosterSets(teacherId, nextSets)
      } catch (error) {
        console.warn('[confirmClassGroups] roster sync skipped', error)
      }

      const classes = await this.listClasses(teacherId)
      const found = classes.find((item) => item.id === classId)
      if (!found) throw new Error('학급을 찾을 수 없습니다.')
      return found
    },

    subscribeSession(sessionId, onChange) {
      const filter = `session_id=eq.${sessionId}`
      const channel = db
        .channel(`session:${sessionId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
          onChange,
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'groups', filter }, onChange)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'group_insights', filter },
          onChange,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'help_requests', filter },
          onChange,
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, onChange)
        .subscribe((status) => {
          if (shouldRefreshSessionSnapshot(status)) onChange()
        })

      return () => {
        void db.removeChannel(channel)
      }
    },
  }
}
