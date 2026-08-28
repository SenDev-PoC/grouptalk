import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { env } from '@/lib/env'
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
  ArchivedGroupSet,
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
    speakerShares: shares.map((share) => ({
      speakerLabel: str(share.speaker_label, '화자'),
      ratio: num(share.ratio),
      utteranceCount: num(share.utterance_count),
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

function mapFormedGroup(row: Row): FormedGroup {
  const members = ((row.class_formed_group_members as Row[] | undefined) ?? [])
    .map((member) => ({
      id: str(member.class_student_id || member.id),
      stuNum: typeof member.stu_num === 'number' ? member.stu_num : undefined,
      name: str(member.name),
      gender: asGender(member.gender),
      academicLevel: asAcademic(member.academic_level),
      engagement: asEngagement(member.engagement),
      position: num(member.position),
    }))
    .sort(byPosition)

  return {
    groupId: num(row.position) + 1,
    groupName: str(row.group_name),
    members: members.map(({ position: _p, ...student }) => student),
  }
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

  const sets = ((row.class_group_sets as Row[] | undefined) ?? [])
    .map((set) => {
      const groups = ((set.class_formed_groups as Row[] | undefined) ?? [])
        .slice()
        .sort((a, b) => num(a.position) - num(b.position))
        .map(mapFormedGroup)
      return {
        id: str(set.id),
        title: str(set.title),
        createdAt: new Date(str(set.created_at)).toLocaleString('ko-KR'),
        isActive: set.is_active === true,
        groups,
        createdAtRaw: str(set.created_at),
      }
    })
    .sort((a, b) => b.createdAtRaw.localeCompare(a.createdAtRaw))

  const active = sets.find((set) => set.isActive) ?? null
  const archived: ArchivedGroupSet[] = sets
    .filter((set) => !set.isActive)
    .map(({ id, title, createdAt, groups }) => ({ id, title, createdAt, groups }))

  return {
    id: str(row.id),
    name: str(row.name),
    subject: nullableStr(row.subject) ?? undefined,
    students,
    relationships,
    activeGroupSet: active
      ? { id: active.id, title: active.title, createdAt: active.createdAt, groups: active.groups }
      : null,
    archivedGroupSets: archived,
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

    async startSession({ teacherId, activityId, useRoster, rosterSetId }) {
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

      if (useRoster && rosterSetId) {
        const rosterGroups = unwrap(
          await db
            .from('roster_groups')
            .select('*, roster_students(*)')
            .eq('roster_set_id', rosterSetId)
            .eq('teacher_id', teacherId)
            .order('position'),
        ) as Row[]

        for (const rosterGroup of rosterGroups) {
          const group = unwrap(
            await db
              .from('groups')
              .insert({
                session_id: sessionId,
                name: str(rosterGroup.name),
                connection_state: 'not_ready',
              })
              .select()
              .single(),
          ) as Row
          const students = (rosterGroup.roster_students as Row[] | undefined) ?? []
          if (students.length > 0) {
            const { error } = await db.from('group_members').insert(
              students
                .map((student) => ({ name: str(student.name), position: num(student.position) }))
                .sort(byPosition)
                .map((student, index) => ({
                  group_id: str(group.id),
                  name: student.name,
                  position: index,
                })),
            )
            if (error) throw new Error(error.message)
          }
        }
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
        // 교사가 미리 만들어 둔 모둠이 있으면 새로 만들지 않고 그 자리에 들어간다.
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
      const { error } = await db
        .from('groups')
        .update({ connection_state: connectionState, last_seen_at: new Date().toISOString() })
        .eq('id', groupId)
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
      const sets = unwrap(
        await db
          .from('roster_sets')
          .select('*, roster_groups(*, roster_students(*))')
          .eq('teacher_id', teacherId)
          .order('position'),
      ) as Row[]

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
      const existing = unwrap(
        await db.from('roster_sets').select('id').eq('teacher_id', teacherId),
      ) as Row[]
      if (existing.length > 0) {
        const { error } = await db
          .from('roster_sets')
          .delete()
          .in(
            'id',
            existing.map((row) => str(row.id)),
          )
        if (error) throw new Error(error.message)
      }

      if (sets.length === 0) return []

      for (const [setIndex, set] of sets.entries()) {
        const setRow = unwrap(
          await db
            .from('roster_sets')
            .insert({
              teacher_id: teacherId,
              name: set.name,
              position: setIndex,
            })
            .select()
            .single(),
        ) as Row

        if (set.groups.length === 0) continue

        const insertedGroups = unwrap(
          await db
            .from('roster_groups')
            .insert(
              set.groups.map((group, index) => ({
                roster_set_id: str(setRow.id),
                teacher_id: teacherId,
                name: group.name,
                position: index,
              })),
            )
            .select(),
        ) as Row[]

        const studentRows = insertedGroups.flatMap((row, index) =>
          (set.groups[index]?.students ?? []).map((name, studentIndex) => ({
            roster_group_id: str(row.id),
            name,
            position: studentIndex,
          })),
        )
        if (studentRows.length > 0) {
          const result = await db.from('roster_students').insert(studentRows)
          if (result.error) throw new Error(result.error.message)
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
            class_group_sets(
              *,
              class_formed_groups(
                *,
                class_formed_group_members(*)
              )
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
        const { error: delStudentsError } = await db
          .from('class_students')
          .delete()
          .eq('class_id', classId)
        if (delStudentsError) throw new Error(delStudentsError.message)
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

      const studentRows = students.map((student, index) => ({
        class_id: classId,
        stu_num: student.stuNum ?? index + 1,
        name: student.name,
        gender: student.gender ?? null,
        academic_level: student.academicLevel ?? null,
        engagement: student.engagement ?? null,
        position: index,
      }))

      const insertedStudents =
        studentRows.length > 0
          ? (unwrap(await db.from('class_students').insert(studentRows).select()) as Row[])
          : []

      const idMap = new Map<string, string>()
      students.forEach((student, index) => {
        const row = insertedStudents[index]
        if (student.id && row) idMap.set(student.id, str(row.id))
      })

      if (relationships.length > 0) {
        const ruleRows = relationships
          .map((rule) => ({
            class_id: classId,
            student_a_id: idMap.get(rule.studentAId) ?? rule.studentAId,
            student_b_id: idMap.get(rule.studentBId) ?? rule.studentBId,
            rule_type: rule.type,
          }))
          .filter((rule) => rule.student_a_id && rule.student_b_id)

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
      const { error } = await db.from('classes').delete().eq('id', classId)
      if (error) throw new Error(error.message)
    },

    async confirmClassGroups({ teacherId, classId, title, groups }) {
      await db.from('class_group_sets').update({ is_active: false }).eq('class_id', classId)

      const setRow = unwrap(
        await db
          .from('class_group_sets')
          .insert({
            class_id: classId,
            title,
            is_active: true,
          })
          .select()
          .single(),
      ) as Row

      for (const [index, group] of groups.entries()) {
        const groupRow = unwrap(
          await db
            .from('class_formed_groups')
            .insert({
              group_set_id: str(setRow.id),
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
            class_student_id: member.id || null,
            name: member.name,
            stu_num: member.stuNum ?? null,
            gender: member.gender ?? null,
            academic_level: member.academicLevel ?? null,
            engagement: member.engagement ?? null,
            position: memberIndex,
          })),
        )
        if (error) throw new Error(error.message)
      }

      const classRow = unwrap(
        await db.from('classes').select('name').eq('id', classId).single(),
      ) as Row
      const rosterName = str(classRow.name)

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

      const classes = await this.listClasses(teacherId)
      const found = classes.find((item) => item.id === classId)
      if (!found) throw new Error('학급을 찾을 수 없습니다.')
      return found
    },

    async restoreClassGroupSet(classId, groupSetId) {
      await db.from('class_group_sets').update({ is_active: false }).eq('class_id', classId)
      unwrap(
        await db
          .from('class_group_sets')
          .update({ is_active: true })
          .eq('id', groupSetId)
          .eq('class_id', classId)
          .select()
          .single(),
      )

      const teacherRow = unwrap(
        await db.from('classes').select('teacher_id').eq('id', classId).single(),
      ) as Row
      const classes = await this.listClasses(str(teacherRow.teacher_id))
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
        .subscribe()

      return () => {
        void db.removeChannel(channel)
      }
    },
  }
}
