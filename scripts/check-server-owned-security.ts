import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { createClient, type RealtimeChannel } from '@supabase/supabase-js'

function localSupabaseEnv() {
  const result = spawnSync('supabase', ['status', '--output', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || 'supabase status failed')
  }

  const values = new Map<string, string>()
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^([A-Z_]+)="(.*)"$/)
    if (match) values.set(match[1], match[2])
  }

  const apiUrl = values.get('API_URL') ?? ''
  const anonKey = values.get('ANON_KEY') ?? values.get('PUBLISHABLE_KEY') ?? ''
  const databaseUrl = values.get('DB_URL') ?? ''
  assert.ok(apiUrl && anonKey && databaseUrl, 'local Supabase credentials are required')
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname),
    'security check must never target a remote Supabase project',
  )
  return { apiUrl, anonKey, databaseUrl }
}

function executeServerSql(databaseUrl: string, sql: string) {
  const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || 'psql failed')
}

function waitForSubscription(channel: RealtimeChannel) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime subscription timed out')), 10_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout)
        reject(new Error(`Realtime subscription failed: ${status}`))
      }
    })
  })
}

async function main() {
  const { apiUrl, anonKey, databaseUrl } = localSupabaseEnv()
  const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false } })

  const activityId = randomUUID()
  const sessionId = randomUUID()
  const groupId = randomUUID()
  let channel: RealtimeChannel | null = null

  try {
    const joinCode = `S${randomUUID().replaceAll('-', '').slice(0, 7)}`
    executeServerSql(
      databaseUrl,
      `
      insert into public.activities (id, teacher_id, title)
      values ('${activityId}', 'security-check-teacher', 'security check');
      insert into public.sessions (id, activity_id, teacher_id, title, join_code, status)
      values (
        '${sessionId}', '${activityId}', 'security-check-teacher',
        'security check', '${joinCode}', 'waiting'
      );
      insert into public.groups (id, session_id, name)
      values ('${groupId}', '${sessionId}', 'security group');
      insert into public.group_insights (group_id, session_id)
      values ('${groupId}', '${sessionId}');
      insert into public.utterances (session_id, group_id, text)
      values ('${sessionId}', '${groupId}', 'server seed');
      `,
    )

    const anonInsight = await anon
      .from('group_insights')
      .select('group_id')
      .eq('group_id', groupId)
      .single()
    assert.ifError(anonInsight.error)
    assert.equal(anonInsight.data.group_id, groupId)

    const forbiddenInsightWrite = await anon
      .from('group_insights')
      .update({ summary: 'forged' })
      .eq('group_id', groupId)
    assert.ok(forbiddenInsightWrite.error, 'anon group_insights UPDATE must fail')

    const forbiddenUtteranceWrite = await anon.from('utterances').insert({
      session_id: sessionId,
      group_id: groupId,
      text: 'forged',
    })
    assert.ok(forbiddenUtteranceWrite.error, 'anon utterances INSERT must fail')

    let receiveEvent!: () => void
    const received = new Promise<void>((resolve) => {
      receiveEvent = resolve
    })
    channel = anon
      .channel(`security-check-${groupId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'group_insights',
          filter: `group_id=eq.${groupId}`,
        },
        () => receiveEvent(),
      )
    await waitForSubscription(channel)

    executeServerSql(
      databaseUrl,
      `update public.group_insights set updated_at = now() where group_id = '${groupId}'`,
    )
    await Promise.race([
      received,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Realtime UPDATE event was not received')), 10_000),
      ),
    ])

    console.log('  ok  anon SELECT 유지 및 server-owned table 쓰기 차단')
    console.log('  ok  PostgreSQL 서버 연결 쓰기 유지')
    console.log('  ok  group_insights Realtime UPDATE 수신 유지')
  } finally {
    if (channel) await anon.removeChannel(channel)
    executeServerSql(
      databaseUrl,
      `delete from public.activities where id = '${activityId}'`,
    )
  }
}

await main()
