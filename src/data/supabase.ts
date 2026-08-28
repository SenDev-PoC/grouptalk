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
  RosterGroup,
  Session,
  SessionStatus,
  SessionSummary,
  Utterance,
} from '@/types/domain'

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

    async startSession({ teacherId, activityId, useRoster }) {
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

      if (useRoster) {
        const rosterGroups = unwrap(
          await db
            .from('roster_groups')
            .select('*, roster_students(*)')
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

    async listRoster(teacherId) {
      const rows = unwrap(
        await db
          .from('roster_groups')
          .select('*, roster_students(*)')
          .eq('teacher_id', teacherId)
          .order('position'),
      ) as Row[]
      return rows.map((row) => ({
        id: str(row.id),
        teacherId,
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
      })) satisfies RosterGroup[]
    },

    async saveRoster(teacherId, groups) {
      const { error } = await db.from('roster_groups').delete().eq('teacher_id', teacherId)
      if (error) throw new Error(error.message)
      if (groups.length === 0) return []

      const inserted = unwrap(
        await db
          .from('roster_groups')
          .insert(
            groups.map((group, index) => ({
              teacher_id: teacherId,
              name: group.name,
              position: index,
            })),
          )
          .select(),
      ) as Row[]

      const studentRows = inserted.flatMap((row, index) =>
        (groups[index]?.students ?? []).map((name, studentIndex) => ({
          roster_group_id: str(row.id),
          name,
          position: studentIndex,
        })),
      )
      if (studentRows.length > 0) {
        const result = await db.from('roster_students').insert(studentRows)
        if (result.error) throw new Error(result.error.message)
      }

      return this.listRoster(teacherId)
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
