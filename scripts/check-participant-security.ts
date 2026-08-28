import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function localEnvironment() {
  const output = execFileSync('supabase', ['status', '--output', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const values = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = line.match(/^([A-Z_]+)="(.*)"$/)
    if (match) values.set(match[1]!, match[2]!)
  }

  const apiUrl = values.get('API_URL') ?? ''
  const databaseUrl = values.get('DB_URL') ?? ''
  const anonKey = values.get('ANON_KEY') ?? values.get('PUBLISHABLE_KEY') ?? ''
  assert.match(apiUrl, /^http:\/\/(127\.0\.0\.1|localhost):/)
  assert.match(databaseUrl, /@(127\.0\.0\.1|localhost):/)
  assert.ok(anonKey)
  return { apiUrl, databaseUrl, anonKey }
}

function runSql(databaseUrl: string, sql: string): string {
  return execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

async function anonymousClient(apiUrl: string, anonKey: string) {
  const client = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const result = await client.auth.signInAnonymously()
  assert.ifError(result.error)
  assert.ok(result.data.user?.is_anonymous)
  assert.ok(result.data.session)
  return { client, userId: result.data.user.id }
}

async function teacherClient(apiUrl: string, anonKey: string) {
  const client = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const result = await client.auth.signUp({
    email: `security-${randomUUID()}@example.com`,
    password: `Secure-${randomUUID()}!`,
  })
  assert.ifError(result.error)
  assert.ok(result.data.user && !result.data.user.is_anonymous)
  assert.ok(result.data.session)
  return { client, userId: result.data.user.id }
}

async function join(
  client: SupabaseClient,
  input: {
    joinCode: string
    groupName: string
    memberNames: string[]
    existingGroupId?: string
  },
) {
  const result = await client.rpc('join_session_group', {
    requested_join_code: input.joinCode,
    requested_group_name: input.groupName,
    requested_member_names: input.memberNames,
    requested_existing_group_id: input.existingGroupId ?? null,
  })
  assert.ifError(result.error)
  assert.ok(Array.isArray(result.data) && result.data.length === 1)
  return result.data[0] as Record<string, unknown>
}

const { apiUrl, databaseUrl, anonKey } = localEnvironment()
const activityId = randomUUID()
const sessionId = randomUUID()
const stepId = randomUUID()
const joinCode = `P${randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase()}`
const userIds: string[] = []
const extraActivityIds: string[] = []

try {
  runSql(
    databaseUrl,
    `
      insert into public.activities (id, teacher_id, title)
      values ('${activityId}', 'participant-security-test', 'participant security test');
      insert into public.sessions (
        id, activity_id, teacher_id, title, join_code, status, use_roster
      ) values (
        '${sessionId}', '${activityId}', 'participant-security-test',
        'participant security test', '${joinCode}', 'waiting', false
      );
      insert into public.session_steps (id, session_id, position, label)
      values ('${stepId}', '${sessionId}', 0, '보안 단계');
    `,
  )

  const unauthenticated = createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const deniedWithoutAuth = await unauthenticated.rpc('join_session_group', {
    requested_join_code: joinCode,
    requested_group_name: '무인증 모둠',
    requested_member_names: ['학생'],
    requested_existing_group_id: null,
  })
  assert.ok(deniedWithoutAuth.error, 'anon role must not execute join_session_group')

  const first = await anonymousClient(apiUrl, anonKey)
  userIds.push(first.userId)
  const preview = await first.client.rpc('get_session_join_preview', {
    requested_join_code: joinCode,
  })
  assert.ifError(preview.error)
  assert.equal((preview.data as Record<string, unknown>)?.groups instanceof Array, true)
  assert.deepEqual((preview.data as Record<string, unknown>).groups, [])
  const preJoinTableRead = await first.client
    .from('sessions')
    .select('id')
    .eq('join_code', joinCode)
  assert.ifError(preJoinTableRead.error)
  assert.deepEqual(preJoinTableRead.data, [])
  const firstJoin = await join(first.client, {
    joinCode,
    groupName: '보안 모둠',
    memberNames: ['학생 A', '학생 B'],
  })
  const groupId = String(firstJoin.group_id)
  const deviceKey = String(firstJoin.client_device_key)
  assert.equal(firstJoin.session_id, sessionId)
  assert.match(deviceKey, /^[0-9a-f]{64}$/)

  const directRead = await first.client.from('session_participants').select('id').limit(1)
  assert.ok(directRead.error, 'participant table must not be directly readable')

  const rejoined = await join(first.client, {
    joinCode,
    groupName: '보안 모둠',
    memberNames: ['변조 시도'],
    existingGroupId: groupId,
  })
  assert.equal(rejoined.group_id, groupId)
  assert.equal(rejoined.client_device_key, deviceKey)
  assert.deepEqual(rejoined.member_names, ['학생 A', '학생 B'])

  const second = await anonymousClient(apiUrl, anonKey)
  userIds.push(second.userId)
  const stolenGroup = await second.client.rpc('join_session_group', {
    requested_join_code: joinCode,
    requested_group_name: '보안 모둠',
    requested_member_names: ['공격자'],
    requested_existing_group_id: groupId,
  })
  assert.ok(stolenGroup.error, 'another anonymous user must not claim an existing group')

  const secondJoin = await join(second.client, {
    joinCode,
    groupName: '다른 모둠',
    memberNames: ['학생 C'],
  })
  const secondGroupId = String(secondJoin.group_id)
  const secondDeviceKey = String(secondJoin.client_device_key)

  const firstVisibleGroups = await first.client
    .from('groups')
    .select('id')
    .eq('session_id', sessionId)
  const secondVisibleGroups = await second.client
    .from('groups')
    .select('id')
    .eq('session_id', sessionId)
  assert.ifError(firstVisibleGroups.error)
  assert.ifError(secondVisibleGroups.error)
  assert.deepEqual(firstVisibleGroups.data, [{ id: groupId }])
  assert.deepEqual(secondVisibleGroups.data, [{ id: secondGroupId }])

  const directGroupUpdate = await first.client
    .from('groups')
    .update({ name: '변조된 모둠' })
    .eq('id', groupId)
  assert.ok(directGroupUpdate.error, 'students must not update group columns directly')

  const binding = runSql(
    databaseUrl,
    `
      select ds.auth_user_id::text || '|' || sp.auth_user_id::text || '|' || ds.client_device_key
      from public.device_sessions ds
      join public.session_participants sp on sp.device_session_id = ds.id
      where ds.session_id = '${sessionId}' and ds.group_id = '${groupId}';
    `,
  )
  assert.equal(binding, `${first.userId}|${first.userId}|${deviceKey}`)

  runSql(
    databaseUrl,
    `update public.sessions set status = 'active', started_at = now() where id = '${sessionId}';`,
  )

  runSql(
    databaseUrl,
    `
      insert into public.group_insights (group_id, session_id)
      values ('${groupId}', '${sessionId}'), ('${secondGroupId}', '${sessionId}');
      insert into public.utterances (session_id, group_id, text)
      values ('${sessionId}', '${groupId}', 'student must not read this');
    `,
  )
  const firstInsights = await first.client
    .from('group_insights')
    .select('group_id')
    .eq('session_id', sessionId)
  assert.ifError(firstInsights.error)
  assert.deepEqual(firstInsights.data, [{ group_id: groupId }])
  const studentUtterances = await first.client
    .from('utterances')
    .select('id')
    .eq('session_id', sessionId)
  assert.ifError(studentUtterances.error)
  assert.deepEqual(studentUtterances.data, [])

  const setStep = await first.client.rpc('set_participant_group_step', {
    requested_group_id: groupId,
    requested_step_id: stepId,
  })
  assert.ifError(setStep.error)
  const crossGroupStep = await second.client.rpc('set_participant_group_step', {
    requested_group_id: groupId,
    requested_step_id: stepId,
  })
  assert.ok(crossGroupStep.error)

  const requestHelp = await first.client.rpc('request_participant_help', {
    requested_session_id: sessionId,
    requested_group_id: groupId,
  })
  assert.ifError(requestHelp.error)
  const helpRequestId = runSql(
    databaseUrl,
    `select id::text from public.help_requests where group_id = '${groupId}';`,
  )
  const secondHelpRead = await second.client
    .from('help_requests')
    .select('id')
    .eq('id', helpRequestId)
  assert.ifError(secondHelpRead.error)
  assert.deepEqual(secondHelpRead.data, [])
  const studentResolve = await first.client.rpc('resolve_teacher_help', {
    requested_help_request_id: helpRequestId,
  })
  assert.ok(studentResolve.error)

  const validPresence = await first.client.rpc('report_group_presence', {
    requested_group_id: groupId,
    requested_client_device_key: deviceKey,
    requested_connection_state: 'live',
  })
  assert.ifError(validPresence.error)
  const successfulHeartbeat = runSql(
    databaseUrl,
    `
      select g.connection_state || '|' || (g.last_seen_at = ds.last_seen_at)::text
      from public.groups g
      join public.device_sessions ds
        on ds.session_id = g.session_id and ds.group_id = g.id
      where g.id = '${groupId}' and ds.client_device_key = '${deviceKey}';
    `,
  )
  assert.equal(successfulHeartbeat, 'live|true')

  const beforeFailures = runSql(
    databaseUrl,
    `select last_seen_at::text from public.groups where id = '${groupId}';`,
  )
  const deniedPresenceCalls = [
    first.client.rpc('report_group_presence', {
      requested_group_id: secondGroupId,
      requested_client_device_key: deviceKey,
      requested_connection_state: 'live',
    }),
    first.client.rpc('report_group_presence', {
      requested_group_id: secondGroupId,
      requested_client_device_key: secondDeviceKey,
      requested_connection_state: 'live',
    }),
    first.client.rpc('report_group_presence', {
      requested_group_id: groupId,
      requested_client_device_key: '0'.repeat(64),
      requested_connection_state: 'live',
    }),
    first.client.rpc('report_group_presence', {
      requested_group_id: groupId,
      requested_client_device_key: deviceKey,
      requested_connection_state: 'forged',
    }),
  ]
  for (const call of deniedPresenceCalls) {
    const result = await call
    assert.ok(result.error, 'invalid presence call must fail')
  }
  assert.equal(
    runSql(databaseUrl, `select last_seen_at::text from public.groups where id = '${groupId}';`),
    beforeFailures,
  )

  const firstTeacher = await teacherClient(apiUrl, anonKey)
  const secondTeacher = await teacherClient(apiUrl, anonKey)
  userIds.push(firstTeacher.userId, secondTeacher.userId)
  const teacherActivityId = randomUUID()
  extraActivityIds.push(teacherActivityId)
  const ownInsert = await firstTeacher.client.from('activities').insert({
    id: teacherActivityId,
    teacher_id: firstTeacher.userId,
    title: '교사 소유 활동',
  })
  assert.ifError(ownInsert.error)
  const forgedTeacherInsert = await secondTeacher.client.from('activities').insert({
    teacher_id: firstTeacher.userId,
    title: '소유권 위조',
  })
  assert.ok(forgedTeacherInsert.error)
  const ownTeacherRead = await firstTeacher.client
    .from('activities')
    .select('id')
    .eq('id', teacherActivityId)
  const otherTeacherRead = await secondTeacher.client
    .from('activities')
    .select('id')
    .eq('id', teacherActivityId)
  assert.deepEqual(ownTeacherRead.data, [{ id: teacherActivityId }])
  assert.deepEqual(otherTeacherRead.data, [])

  runSql(
    databaseUrl,
    `
      update public.device_sessions
      set ended_at = now(), readiness_state = 'confirm_required'
      where session_id = '${sessionId}' and group_id = '${groupId}';
    `,
  )
  const endedDevicePresence = await first.client.rpc('report_group_presence', {
    requested_group_id: groupId,
    requested_client_device_key: deviceKey,
    requested_connection_state: 'live',
  })
  assert.ok(endedDevicePresence.error, 'ended device session must not report presence')
  assert.equal(
    runSql(databaseUrl, `select last_seen_at::text from public.groups where id = '${groupId}';`),
    beforeFailures,
  )

  console.log('  ok  미인증 anon 역할의 join RPC 실행 차단')
  console.log('  ok  anonymous Auth 학생의 원자적 모둠·기기 등록')
  console.log('  ok  서버 생성 32-byte 기기 키와 Auth 사용자 결합')
  console.log('  ok  같은 학생 재입장 멱등 처리 및 다른 학생의 모둠 탈취 차단')
  console.log('  ok  session_participants 브라우저 직접 조회 차단')
  console.log('  ok  JWT·사용자·모둠·기기 키가 일치한 Presence만 DB 시계로 갱신')
  console.log('  ok  다른 모둠/사용자 키·없는 키·잘못된 상태·종료 기기의 Presence 차단')
  console.log('  ok  실패한 Presence가 groups.last_seen_at을 변경하지 않음')
  console.log('  ok  입장 전 직접 테이블 조회 차단 및 join-code preview만 허용')
  console.log('  ok  학생별 모둠·insight·도움 요청 격리와 직접 group 변조 차단')
  console.log('  ok  학생의 utterances 조회·교사 전용 도움 해결 차단')
  console.log('  ok  교사별 teacher_id 소유권 생성·조회 격리')
} finally {
  for (const extraActivityId of extraActivityIds) {
    runSql(databaseUrl, `delete from public.activities where id = '${extraActivityId}';`)
  }
  runSql(databaseUrl, `delete from public.activities where id = '${activityId}';`)
  if (userIds.length > 0) {
    runSql(
      databaseUrl,
      `delete from auth.users where id in (${userIds.map((id) => `'${id}'`).join(', ')});`,
    )
  }
}
