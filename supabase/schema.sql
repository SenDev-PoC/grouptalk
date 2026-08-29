-- 모둠뷰 프론트엔드와 FastAPI가 공유하는 스키마 계약
--
-- 기존 프론트엔드 테이블·컬럼·상태값은 유지한다.
-- FastAPI가 중복 기기, 재연결, 늦은 관찰, 명령 재시도를 안전하게 처리할
-- 서버 전용 테이블과 제약을 함께 정의한다.
-- 원본 음성은 저장하지 않는다. 실제 LiveKit 확정 전사는 익명 화자 표지와
-- 멱등 source event ID를 붙여 저장할 수 있다.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 교사가 저장해 두는 활동 템플릿
-- ─────────────────────────────────────────────────────────────
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  text        not null,
  title       text        not null,
  created_at  timestamptz not null default now()
);

create table if not exists activity_steps (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities (id) on delete cascade,
  position    int  not null,
  label       text not null
);

-- ─────────────────────────────────────────────────────────────
-- 활동을 실제로 연 세션. 학생은 join_code 로 들어온다.
-- ─────────────────────────────────────────────────────────────
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities (id) on delete cascade,
  teacher_id  text not null,
  title       text not null,
  join_code   text not null unique,
  status      text not null default 'waiting' check (status in ('waiting', 'active', 'ended')),
  use_roster  boolean not null default false,
  version     bigint not null default 0 check (version >= 0),
  data_mode   text not null default 'synthetic' check (data_mode in ('synthetic', 'live')),
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  ended_at    timestamptz,
  constraint sessions_status_timestamps_check check (
    (status = 'waiting' and started_at is null and ended_at is null)
    or (status = 'active' and started_at is not null and ended_at is null)
    or (
      status = 'ended'
      and started_at is not null
      and ended_at is not null
      and ended_at >= started_at
    )
  )
);

-- 세션 시점의 단계 스냅샷. 활동 템플릿이 나중에 바뀌어도 기록이 흔들리지 않는다.
create table if not exists session_steps (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  position   int  not null,
  label      text not null,
  constraint session_steps_session_position_key unique (session_id, position),
  constraint session_steps_session_id_key unique (session_id, id)
);

-- ─────────────────────────────────────────────────────────────
-- 모둠. 공용 기기의 실제 접속·재연결 수명은 device_sessions가 소유하고,
-- groups.connection_state는 기존 프론트엔드가 읽는 현재 표시값으로 유지한다.
-- joined_at 이 null 이면 아직 들어오지 않은 모둠(교사가 미리 배정만 해 둔 상태).
-- ─────────────────────────────────────────────────────────────
create table if not exists groups (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references sessions (id) on delete cascade,
  name             text not null,
  joined_at        timestamptz,
  current_step_id  uuid,
  connection_state text not null default 'not_ready'
                   check (connection_state in ('not_ready', 'connecting', 'live', 'lost')),
  -- 학생 기기가 8초마다 갱신한다. 교사 화면은 이 값으로 연결 실패를 판정한다.
  last_seen_at     timestamptz,
  constraint groups_session_name_key unique (session_id, name),
  constraint groups_session_id_key unique (session_id, id),
  constraint groups_current_step_fk
    foreign key (session_id, current_step_id)
    references session_steps (session_id, id)
    on delete set null (current_step_id)
);

-- 공용 기기 heartbeat는 브라우저 시계가 아니라 PostgreSQL 시계로 기록한다.
create or replace function public.report_group_presence(
  requested_group_id uuid,
  requested_client_device_key text,
  requested_connection_state text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_device_session_id uuid;
  v_session_id uuid;
  v_now timestamptz := statement_timestamp();
begin
  if v_auth_user_id is null
     or coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true' then
    raise exception 'anonymous student authentication required' using errcode = '42501';
  end if;

  if requested_connection_state not in ('not_ready', 'connecting', 'live', 'lost') then
    raise exception 'invalid group connection state' using errcode = '22023';
  end if;

  if requested_client_device_key is null
     or char_length(requested_client_device_key) not between 32 and 256 then
    raise exception 'invalid device credential' using errcode = '42501';
  end if;

  select ds.id, ds.session_id
  into v_device_session_id, v_session_id
  from public.device_sessions as ds
  join public.session_participants as sp
    on sp.device_session_id = ds.id
   and sp.session_id = ds.session_id
   and sp.group_id = ds.group_id
  join public.sessions as s on s.id = ds.session_id
  where ds.auth_user_id = v_auth_user_id
    and sp.auth_user_id = v_auth_user_id
    and ds.client_device_key = requested_client_device_key
    and ds.group_id = requested_group_id
    and ds.readiness_state = 'ready'
    and ds.ended_at is null
    and sp.ended_at is null
    and s.status = 'active'
  limit 1
  for update of ds, sp;

  if not found then
    raise exception 'device credential does not match active group' using errcode = '42501';
  end if;

  update public.device_sessions as ds
  set last_seen_at = v_now,
      connection_state = case requested_connection_state
        when 'connecting' then 'connecting'
        when 'live' then 'connected'
        when 'lost' then 'failed'
        else 'disconnected'
      end,
      version = ds.version + 1
  where ds.id = v_device_session_id;

  update public.groups as g
  set connection_state = requested_connection_state, last_seen_at = v_now
  where g.id = requested_group_id and g.session_id = v_session_id;

  if not found then
    raise exception 'active group not found' using errcode = 'P0002';
  end if;
end;
$$;

alter function public.report_group_presence(uuid, text, text) owner to postgres;
revoke all on function public.report_group_presence(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.report_group_presence(uuid, text, text) to authenticated;

comment on function public.report_group_presence(uuid, text, text) is
  'Updates presence only for the active anonymous Auth participant and its server-issued group device key.';

create table if not exists group_members (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  name     text not null,
  position int  not null default 0
);

-- ─────────────────────────────────────────────────────────────
-- 공용 기기의 접속·재연결 단위. 한 모둠에는 미종료 ready 기기가 하나만
-- 존재할 수 있고, 같은 브라우저 기기의 재연결은 generation으로 구분한다.
-- ─────────────────────────────────────────────────────────────
create table if not exists device_sessions (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null,
  group_id             uuid not null,
  auth_user_id         uuid references auth.users (id) on delete cascade,
  client_device_key    text not null,
  generation           int not null default 1 check (generation >= 1),
  readiness_state      text not null default 'unconfirmed'
                       check (readiness_state in ('unconfirmed', 'ready', 'confirm_required')),
  connection_state     text not null default 'disconnected'
                       check (connection_state in ('connecting', 'connected', 'disconnected', 'failed')),
  collection_state     text not null default 'idle'
                       check (collection_state in ('idle', 'collecting', 'stopped', 'error')),
  collection_started_at timestamptz,
  last_seen_at         timestamptz,
  confirmed_at         timestamptz,
  ended_at             timestamptz,
  version              bigint not null default 0 check (version >= 0),
  created_at           timestamptz not null default now(),
  constraint device_sessions_group_fk
    foreign key (session_id, group_id)
    references groups (session_id, id)
    on delete cascade,
  constraint device_sessions_generation_key
    unique (session_id, client_device_key, generation),
  constraint device_sessions_session_group_id_key
    unique (session_id, group_id, id),
  constraint device_sessions_ready_timestamp_check check (
    (readiness_state <> 'ready' or confirmed_at is not null)
    and (confirmed_at is null or confirmed_at >= created_at)
  ),
  constraint device_sessions_collection_timestamp_check check (
    (
      (collection_state = 'idle' and collection_started_at is null)
      or (collection_state = 'collecting' and collection_started_at is not null)
      or collection_state in ('stopped', 'error')
    )
    and (collection_started_at is null or collection_started_at >= created_at)
  ),
  constraint device_sessions_ended_timestamp_check check (
    ended_at is null or ended_at >= created_at
  )
);

create unique index if not exists device_sessions_one_current_device_key
  on device_sessions (session_id, client_device_key)
  where ended_at is null;

create unique index if not exists device_sessions_one_ready_group
  on device_sessions (session_id, group_id)
  where readiness_state = 'ready' and ended_at is null;

create index if not exists device_sessions_recent_group_idx
  on device_sessions (session_id, group_id, last_seen_at desc);

create index if not exists device_sessions_auth_user_idx
  on device_sessions (auth_user_id, session_id)
  where auth_user_id is not null and ended_at is null;

create table if not exists session_participants (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid not null references auth.users (id) on delete cascade,
  session_id        uuid not null,
  group_id          uuid not null,
  device_session_id uuid not null,
  joined_at         timestamptz not null default now(),
  ended_at          timestamptz,
  constraint session_participants_device_fk
    foreign key (session_id, group_id, device_session_id)
    references device_sessions (session_id, group_id, id)
    on delete cascade,
  constraint session_participants_end_check
    check (ended_at is null or ended_at >= joined_at)
);

create unique index if not exists session_participants_one_active_user
  on session_participants (session_id, auth_user_id)
  where ended_at is null;

create unique index if not exists session_participants_one_device
  on session_participants (device_session_id);

-- ─────────────────────────────────────────────────────────────
-- LiveKit worker/API가 보낸 구조화 관찰의 추가 전용 처리 원장.
-- 원문이나 음성은 저장하지 않고 익명 화자별 수치만 저장한다.
-- ─────────────────────────────────────────────────────────────
create table if not exists conversation_observations (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null,
  group_id          uuid not null,
  device_session_id uuid not null,
  client_event_id   text not null,
  occurred_at       timestamptz not null,
  received_at       timestamptz not null default now(),
  source            text not null check (source in ('synthetic', 'live')),
  apply_status      text not null
                    check (apply_status in ('accepted', 'ignored_after_end', 'ignored_old_session', 'invalid')),
  speaker_label     text,
  speaking_ms       int check (speaking_ms is null or speaking_ms >= 0),
  turn_count        int check (turn_count is null or turn_count >= 0),
  constraint conversation_observations_device_fk
    foreign key (session_id, group_id, device_session_id)
    references device_sessions (session_id, group_id, id)
    on delete cascade,
  constraint conversation_observations_event_key
    unique (device_session_id, client_event_id),
  constraint conversation_observations_accepted_metrics_check check (
    apply_status <> 'accepted'
    or (speaking_ms is not null and turn_count is not null)
  )
);

create index if not exists conversation_observations_recent_group_idx
  on conversation_observations (session_id, group_id, received_at desc);

-- ─────────────────────────────────────────────────────────────
-- 시작·종료 명령의 멱등 처리 결과. 같은 request_key에 다른 fingerprint가
-- 들어오면 FastAPI가 충돌로 거부하고 기존 결과를 재사용하지 않는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists command_receipts (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references sessions (id) on delete cascade,
  operation           text not null check (operation in ('start_session', 'end_session')),
  request_key         text not null,
  request_fingerprint text not null,
  response_status     smallint not null check (response_status between 100 and 599),
  result_version      bigint not null check (result_version >= 0),
  created_at          timestamptz not null default now(),
  constraint command_receipts_request_key
    unique (session_id, operation, request_key)
);

-- ─────────────────────────────────────────────────────────────
-- 합성 데모 전사문과 실제 LiveKit 확정 전사. 프론트엔드는 리포트에서 읽기만 한다.
-- speaker_label 은 익명 화자 표시이며 학생 이름과 연결하지 않는다.
-- 원본 음성은 이 테이블이나 다른 영속 저장소에 저장하지 않는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists utterances (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references sessions (id) on delete cascade,
  group_id        uuid not null,
  speaker_label   text,
  text            text not null,
  data_source     text not null default 'synthetic',
  source_event_id text,
  spoken_at       timestamptz not null default now(),
  start_ms        bigint,
  end_ms          bigint,
  created_at      timestamptz not null default now(),
  constraint utterances_group_fk
    foreign key (session_id, group_id)
    references groups (session_id, id)
    on delete cascade,
  constraint utterances_data_source_check
    check (data_source in ('synthetic', 'live')),
  constraint utterances_source_event_shape_check check (
    (data_source = 'synthetic' and source_event_id is null)
    or
    (
      data_source = 'live'
      and source_event_id is not null
      and char_length(source_event_id) between 1 and 128
    )
  ),
  constraint utterances_timing_shape_check check (
    (data_source = 'synthetic' and start_ms is null and end_ms is null)
    or
    (
      data_source = 'live'
      and (
        (start_ms is null and end_ms is null)
        or
        (
          start_ms is not null
          and end_ms is not null
          and start_ms >= 0
          and end_ms > start_ms
        )
      )
    )
  )
);

create index if not exists utterances_session_idx on utterances (session_id, spoken_at);

create unique index if not exists utterances_live_event_key
  on utterances (session_id, group_id, source_event_id)
  where source_event_id is not null;

create index if not exists utterances_live_analysis_window_idx
  on utterances (session_id, group_id, spoken_at desc, created_at desc, id desc)
  where data_source = 'live';

-- ─────────────────────────────────────────────────────────────
-- 핵심 참여 분석 결과. FastAPI의 participation-duration-v1이 모둠당 1행을 upsert 한다.
-- 프론트엔드는 절대 쓰지 않고 realtime 으로 구독만 한다.
-- ─────────────────────────────────────────────────────────────
create table if not exists group_insights (
  group_id            uuid primary key,
  session_id          uuid not null references sessions (id) on delete cascade,
  -- balanced: 고른 참여 / skewed: 한 화자 중심 / insufficient: 근거 부족 / unknown: 판단 불가
  participation_state text not null default 'insufficient'
                      check (participation_state in ('balanced', 'skewed', 'insufficient', 'unknown')),
  -- [{ "speaker_label": "화자 A", "ratio": 0.62, "utterance_count": 31 }]
  speaker_shares      jsonb not null default '[]'::jsonb,
  off_topic_ratio     real,
  -- [{ "quote": "...", "reason": "...", "at": "2026-08-28T10:00:00Z" }]
  off_topic_evidence  jsonb not null default '[]'::jsonb,
  summary             text,
  keywords            text[] not null default '{}',
  data_sufficiency    text not null default 'insufficient'
                      check (data_sufficiency in ('none', 'insufficient', 'sufficient')),
  judgability         text not null default 'unjudgable'
                      check (judgability in ('judgable', 'unjudgable')),
  reason_code         text default 'insufficient_data',
  evidence_from       timestamptz,
  evidence_to         timestamptz,
  observation_count   int not null default 0 check (observation_count >= 0),
  analysis_version    text not null default 'demo-v1',
  participation_equity numeric,
  total_speaking_ms   bigint,
  joined_participant_count int,
  silent_participant_count int,
  participation_alert_state text not null default 'NORMAL',
  alert_pending_since timestamptz,
  alert_active_since  timestamptz,
  alert_recovery_since timestamptz,
  alert_cooldown_until timestamptz,
  alert_last_observed_at timestamptz,
  topic_relevance     text,
  analysis_status     text not null default 'idle',
  analysis_confidence numeric,
  analysis_source_utterance_id uuid,
  analysis_attempted_at timestamptz,
  analysis_retry_count integer not null default 0,
  analysis_retry_after timestamptz,
  analysis_last_error_code text,
  data_source         text not null default 'synthetic'
                      check (data_source in ('synthetic', 'live')),
  -- 이 값이 45초 이상 오래되면 교사 화면은 '갱신 중단'으로 표시한다.
  updated_at          timestamptz not null default now(),
  constraint group_insights_group_fk
    foreign key (session_id, group_id)
    references groups (session_id, id)
    on delete cascade,
  constraint group_insights_reason_check check (
    (judgability = 'judgable' and reason_code is null)
    or (judgability = 'unjudgable' and reason_code is not null)
  ),
  constraint group_insights_state_mapping_check check (
    (
      participation_state = 'insufficient'
      and data_sufficiency in ('none', 'insufficient')
      and judgability = 'unjudgable'
    )
    or (
      participation_state = 'unknown'
      and data_sufficiency = 'sufficient'
      and judgability = 'unjudgable'
    )
    or (
      participation_state in ('balanced', 'skewed')
      and data_sufficiency = 'sufficient'
      and judgability = 'judgable'
    )
  ),
  constraint group_insights_evidence_check check (
    participation_state not in ('balanced', 'skewed')
    or (
      observation_count > 0
      and evidence_from is not null
      and evidence_to is not null
      and evidence_from <= evidence_to
    )
  ),
  constraint group_insights_equity_check check (
    participation_equity is null
    or (participation_equity >= 0 and participation_equity <= 1)
  ),
  constraint group_insights_participant_counts_check check (
    (
      total_speaking_ms is null
      and silent_participant_count is null
      and (joined_participant_count is null or joined_participant_count > 0)
    )
    or
    (
      total_speaking_ms is not null and total_speaking_ms >= 0
      and joined_participant_count is not null and joined_participant_count > 0
      and silent_participant_count is not null and silent_participant_count >= 0
      and silent_participant_count <= joined_participant_count
    )
  ),
  constraint group_insights_alert_state_check check (
    participation_alert_state in ('NORMAL', 'PENDING', 'ACTIVE')
  ),
  constraint group_insights_alert_state_shape_check check (
    (
      participation_alert_state = 'NORMAL'
      and alert_pending_since is null
      and alert_active_since is null
      and alert_recovery_since is null
    )
    or
    (
      participation_alert_state = 'PENDING'
      and alert_pending_since is not null
      and alert_active_since is null
      and alert_recovery_since is null
      and alert_cooldown_until is null
    )
    or
    (
      participation_alert_state = 'ACTIVE'
      and alert_pending_since is null
      and alert_active_since is not null
      and alert_cooldown_until is null
    )
  ),
  constraint group_insights_topic_relevance_check check (
    topic_relevance is null or topic_relevance in ('on_topic', 'mixed', 'off_topic')
  ),
  constraint group_insights_analysis_status_check check (
    analysis_status in ('idle', 'completed', 'insufficient', 'failed')
  ),
  constraint group_insights_analysis_confidence_check check (
    analysis_confidence is null
    or (analysis_confidence >= 0 and analysis_confidence <= 1)
  ),
  constraint group_insights_analysis_retry_count_check check (
    analysis_retry_count >= 0
  ),
  constraint group_insights_analysis_retry_shape_check check (
    analysis_retry_after is null
    or (analysis_status = 'failed' and analysis_retry_count > 0)
  ),
  constraint group_insights_completed_analysis_check check (
    analysis_status <> 'completed'
    or (
      topic_relevance is not null
      and summary is not null and char_length(btrim(summary)) > 0
      and cardinality(keywords) between 1 and 6
      and analysis_confidence is not null
      and analysis_source_utterance_id is not null
      and analysis_attempted_at is not null
    )
  )
);

create index if not exists group_insights_session_idx on group_insights (session_id);

-- ─────────────────────────────────────────────────────────────
-- 학생이 누른 도움 요청. 교사 화면에 누른 순서대로 뜬다.
-- ─────────────────────────────────────────────────────────────
create table if not exists help_requests (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions (id) on delete cascade,
  group_id    uuid not null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  constraint help_requests_group_fk
    foreign key (session_id, group_id)
    references groups (session_id, id)
    on delete cascade
);

create index if not exists help_requests_session_idx on help_requests (session_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- FastAPI 트랜잭션 불변조건
-- 아래 규칙은 여러 행의 이전·현재 상태를 함께 봐야 하므로 행 CHECK가 아니라
-- 조건부 UPDATE와 행 잠금으로 보장한다.
--
-- 1. sessions는 version을 조건으로 waiting → active → ended만 허용한다.
-- 2. ended 세션의 관찰은 ignored_after_end로 기록하되 groups와
--    group_insights의 현재 표시값을 갱신하지 않는다.
-- 3. device_sessions가 기기 세대의 정본이며, 같은 상태 변경 트랜잭션이
--    groups.connection_state와 groups.last_seen_at을 갱신한다.
-- 4. conversation_observations는 추가 전용 원장이다. accepted 관찰만
--    group_insights의 현재 표시값 계산에 사용한다.
-- 5. 같은 command receipt 키와 fingerprint는 저장된 결과를 재사용한다.
--    같은 키에 다른 fingerprint가 오면 상태를 바꾸지 않고 충돌로 거부한다.
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- 모둠 편성 탭에서 미리 저장하는 모둠 배정 (세트 → 모둠 → 학생)
-- ─────────────────────────────────────────────────────────────
create table if not exists roster_sets (
  id         uuid primary key default gen_random_uuid(),
  teacher_id text not null,
  name       text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists roster_groups (
  id            uuid primary key default gen_random_uuid(),
  roster_set_id uuid not null references roster_sets (id) on delete cascade,
  teacher_id    text not null,
  name          text not null,
  position      int  not null default 0
);

create table if not exists roster_students (
  id              uuid primary key default gen_random_uuid(),
  roster_group_id uuid not null references roster_groups (id) on delete cascade,
  name            text not null,
  position        int  not null default 0
);

-- ─────────────────────────────────────────────────────────────
-- 모둠 편성: 학급 · 학생 · 관계 규칙 · 현재 확정 편성
-- (이전 편성 기록 없음. 확정 시 덮어쓰고 roster_sets 에 동기화)
-- ─────────────────────────────────────────────────────────────
create table if not exists classes (
  id         uuid primary key default gen_random_uuid(),
  teacher_id text not null,
  name       text not null,
  subject    text,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists class_students (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references classes (id) on delete cascade,
  stu_num         int,
  name            text not null,
  gender          text check (gender is null or gender in ('M', 'F')),
  academic_level  text check (academic_level is null or academic_level in ('high', 'mid', 'low')),
  engagement      text check (engagement is null or engagement in ('active', 'moderate', 'passive')),
  position        int  not null default 0
);

create table if not exists class_relationship_rules (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references classes (id) on delete cascade,
  student_a_id  uuid not null references class_students (id) on delete cascade,
  student_b_id  uuid not null references class_students (id) on delete cascade,
  rule_type     text not null check (rule_type in ('mustSeparate', 'mustTogether', 'preferTogether')),
  constraint class_relationship_distinct check (student_a_id <> student_b_id)
);

-- 학급당 현재 확정 모둠만 유지 (이전 편성 기록 없음)
create table if not exists class_formed_groups (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references classes (id) on delete cascade,
  group_name text not null,
  position   int  not null default 0
);

create table if not exists class_formed_group_members (
  id               uuid primary key default gen_random_uuid(),
  formed_group_id  uuid not null references class_formed_groups (id) on delete cascade,
  class_student_id uuid not null references class_students (id) on delete cascade,
  position         int  not null default 0,
  unique (formed_group_id, class_student_id)
);

create index if not exists classes_teacher_idx on classes (teacher_id, position);
create index if not exists class_students_class_idx on class_students (class_id, position);
create index if not exists class_relationship_rules_class_idx on class_relationship_rules (class_id);
create index if not exists class_formed_groups_class_idx on class_formed_groups (class_id, position);
create index if not exists class_formed_group_members_group_idx on class_formed_group_members (formed_group_id, position);

-- ─────────────────────────────────────────────────────────────
-- Realtime
-- 프론트엔드는 sessions / groups / group_members / group_insights / help_requests 의
-- 변경을 session_id 필터로 구독한다.
-- UPDATE 이벤트에도 필터가 걸리도록 REPLICA IDENTITY FULL 이 필요하다.
-- ─────────────────────────────────────────────────────────────
alter table sessions       replica identity full;
alter table groups         replica identity full;
alter table group_members  replica identity full;
alter table group_insights replica identity full;
alter table help_requests  replica identity full;

alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table groups;
alter publication supabase_realtime add table group_members;
alter publication supabase_realtime add table group_insights;
alter publication supabase_realtime add table help_requests;

-- ─────────────────────────────────────────────────────────────
-- RLS
-- 교사는 auth.uid()와 teacher_id가 일치하는 데이터만, 학생 anonymous Auth
-- 사용자는 session_participants에 결합된 자기 세션·모둠만 접근한다.
-- ─────────────────────────────────────────────────────────────
alter table activities      enable row level security;
alter table activity_steps  enable row level security;
alter table sessions        enable row level security;
alter table session_steps   enable row level security;
alter table groups          enable row level security;
alter table group_members   enable row level security;
alter table utterances      enable row level security;
alter table group_insights  enable row level security;
alter table help_requests   enable row level security;
alter table roster_sets     enable row level security;
alter table roster_groups   enable row level security;
alter table roster_students enable row level security;
alter table classes                    enable row level security;
alter table class_students             enable row level security;
alter table class_relationship_rules   enable row level security;
alter table class_formed_groups        enable row level security;
alter table class_formed_group_members enable row level security;
alter table device_sessions enable row level security;
alter table session_participants enable row level security;
alter table conversation_observations enable row level security;
alter table command_receipts enable row level security;

revoke all on table session_participants from anon, authenticated;
revoke select (auth_user_id) on table device_sessions from anon, authenticated;

create or replace function public.join_session_group(
  requested_join_code text,
  requested_group_name text,
  requested_member_names text[],
  requested_existing_group_id uuid default null
)
returns table (
  session_id uuid,
  group_id uuid,
  group_name text,
  member_names text[],
  client_device_key text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_session public.sessions%rowtype;
  v_group public.groups%rowtype;
  v_existing_group_id uuid;
  v_existing_device_key text;
  v_member_names text[];
  v_device_session_id uuid;
  v_device_key text;
  v_now timestamptz := statement_timestamp();
begin
  if v_auth_user_id is null
     or coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true' then
    raise exception 'anonymous student authentication required' using errcode = '42501';
  end if;

  if requested_join_code is null or char_length(btrim(requested_join_code)) < 4 then
    raise exception 'invalid join code' using errcode = '22023';
  end if;

  select s.* into v_session
  from public.sessions as s
  where s.join_code = upper(btrim(requested_join_code))
    and s.status in ('waiting', 'active')
  for update;

  if not found then
    raise exception 'session is not joinable' using errcode = 'P0002';
  end if;

  select sp.group_id, ds.client_device_key
  into v_existing_group_id, v_existing_device_key
  from public.session_participants as sp
  join public.device_sessions as ds
    on ds.id = sp.device_session_id
   and ds.session_id = sp.session_id
   and ds.group_id = sp.group_id
  where sp.session_id = v_session.id
    and sp.auth_user_id = v_auth_user_id
    and sp.ended_at is null
    and ds.ended_at is null
  limit 1
  for update of sp, ds;

  if found then
    select g.* into v_group
    from public.groups as g
    where g.id = v_existing_group_id and g.session_id = v_session.id;

    if requested_existing_group_id is not null
       and requested_existing_group_id <> v_group.id then
      raise exception 'participant is already joined to another group' using errcode = '42501';
    end if;
    if btrim(requested_group_name) <> v_group.name then
      raise exception 'participant group does not match request' using errcode = '42501';
    end if;

    select coalesce(array_agg(gm.name order by gm.position, gm.id), '{}'::text[])
    into v_member_names
    from public.group_members as gm
    where gm.group_id = v_group.id;

    return query
    select v_session.id, v_group.id, v_group.name, v_member_names, v_existing_device_key;
    return;
  end if;

  if requested_group_name is null
     or char_length(btrim(requested_group_name)) not between 1 and 100 then
    raise exception 'invalid group name' using errcode = '22023';
  end if;

  if v_session.use_roster then
    if requested_existing_group_id is null then
      raise exception 'a roster group must be selected' using errcode = '22023';
    end if;

    select g.* into v_group
    from public.groups as g
    where g.id = requested_existing_group_id and g.session_id = v_session.id
    for update;

    if not found or v_group.joined_at is not null
       or v_group.name <> btrim(requested_group_name) then
      raise exception 'roster group is unavailable' using errcode = '42501';
    end if;

    update public.groups as g
    set joined_at = v_now, last_seen_at = v_now, connection_state = 'not_ready'
    where g.id = v_group.id
    returning g.* into v_group;
  else
    if requested_existing_group_id is not null then
      raise exception 'an existing group cannot be claimed' using errcode = '42501';
    end if;

    select coalesce(array_agg(btrim(member_name)), '{}'::text[])
    into v_member_names
    from unnest(coalesce(requested_member_names, '{}'::text[])) as member_name
    where char_length(btrim(member_name)) > 0;

    if cardinality(v_member_names) not between 1 and 20
       or exists (
         select 1 from unnest(v_member_names) as member_name
         where char_length(member_name) > 100
       ) then
      raise exception 'invalid member names' using errcode = '22023';
    end if;

    insert into public.groups (
      session_id, name, joined_at, last_seen_at, connection_state
    ) values (
      v_session.id, btrim(requested_group_name), v_now, v_now, 'not_ready'
    ) returning * into v_group;

    insert into public.group_members (group_id, name, position)
    select v_group.id, member_name, ordinal - 1
    from unnest(v_member_names) with ordinality as names(member_name, ordinal);
  end if;

  select coalesce(array_agg(gm.name order by gm.position, gm.id), '{}'::text[])
  into v_member_names
  from public.group_members as gm
  where gm.group_id = v_group.id;

  update public.device_sessions as ds
  set ended_at = v_now,
      readiness_state = 'confirm_required',
      connection_state = 'disconnected',
      collection_state = case
        when ds.collection_state = 'collecting' then 'stopped'
        else ds.collection_state
      end,
      version = ds.version + 1
  where ds.session_id = v_session.id
    and ds.group_id = v_group.id
    and ds.ended_at is null;

  v_device_key := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.device_sessions (
    session_id, group_id, auth_user_id, client_device_key, generation,
    readiness_state, connection_state, collection_state, last_seen_at, confirmed_at
  ) values (
    v_session.id, v_group.id, v_auth_user_id, v_device_key, 1,
    'ready', 'disconnected', 'idle', v_now, v_now
  ) returning id into v_device_session_id;

  insert into public.session_participants (
    auth_user_id, session_id, group_id, device_session_id
  ) values (
    v_auth_user_id, v_session.id, v_group.id, v_device_session_id
  );

  return query
  select v_session.id, v_group.id, v_group.name, v_member_names, v_device_key;
end;
$$;

alter function public.join_session_group(text, text, text[], uuid) owner to postgres;
revoke all on function public.join_session_group(text, text, text[], uuid)
from public, anon, authenticated;
grant execute on function public.join_session_group(text, text, text[], uuid)
to authenticated;

create or replace function public.is_session_teacher(requested_session_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
    and exists (
      select 1 from public.sessions as s
      where s.id = requested_session_id
        and s.teacher_id = auth.uid()::text
    );
$$;

create or replace function public.is_session_participant(requested_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true'
    and exists (
      select 1 from public.session_participants as sp
      where sp.session_id = requested_session_id
        and sp.auth_user_id = auth.uid()
        and sp.ended_at is null
    );
$$;

create or replace function public.is_group_participant(requested_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true'
    and exists (
      select 1 from public.session_participants as sp
      where sp.group_id = requested_group_id
        and sp.auth_user_id = auth.uid()
        and sp.ended_at is null
    );
$$;

alter function public.is_session_teacher(uuid) owner to postgres;
alter function public.is_session_participant(uuid) owner to postgres;
alter function public.is_group_participant(uuid) owner to postgres;
revoke all on function public.is_session_teacher(uuid) from public, anon;
revoke all on function public.is_session_participant(uuid) from public, anon;
revoke all on function public.is_group_participant(uuid) from public, anon;
grant execute on function public.is_session_teacher(uuid) to authenticated;
grant execute on function public.is_session_participant(uuid) to authenticated;
grant execute on function public.is_group_participant(uuid) to authenticated;

revoke all on table
  public.activities,
  public.activity_steps,
  public.sessions,
  public.session_steps,
  public.groups,
  public.group_members,
  public.utterances,
  public.group_insights,
  public.help_requests,
  public.roster_sets,
  public.roster_groups,
  public.roster_students,
  public.classes,
  public.class_students,
  public.class_relationship_rules,
  public.class_formed_groups,
  public.class_formed_group_members
from anon, authenticated;

revoke all on table
  public.device_sessions,
  public.session_participants,
  public.conversation_observations,
  public.command_receipts
from anon, authenticated;

grant select, insert, update, delete on table
  public.activities,
  public.activity_steps,
  public.sessions,
  public.session_steps,
  public.roster_sets,
  public.roster_groups,
  public.roster_students,
  public.classes,
  public.class_students,
  public.class_relationship_rules,
  public.class_formed_groups,
  public.class_formed_group_members
to authenticated;

grant select, insert, delete on table public.groups, public.group_members to authenticated;
grant select on table public.utterances, public.group_insights, public.help_requests to authenticated;

create policy activities_teacher_all on public.activities
for all to authenticated
using (
  coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
  and teacher_id = auth.uid()::text
)
with check (
  coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
  and teacher_id = auth.uid()::text
);

create policy activity_steps_teacher_all on public.activity_steps
for all to authenticated
using (
  exists (
    select 1 from public.activities as a
    where a.id = activity_id and a.teacher_id = auth.uid()::text
  )
)
with check (
  exists (
    select 1 from public.activities as a
    where a.id = activity_id and a.teacher_id = auth.uid()::text
  )
);

create policy sessions_scoped_read on public.sessions
for select to authenticated
using (
  (
    coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
    and teacher_id = auth.uid()::text
  )
  or public.is_session_participant(id)
);

create policy sessions_teacher_insert on public.sessions
for insert to authenticated
with check (
  coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
  and teacher_id = auth.uid()::text
  and exists (
    select 1 from public.activities as a
    where a.id = activity_id and a.teacher_id = auth.uid()::text
  )
);

create policy sessions_teacher_update on public.sessions
for update to authenticated
using (public.is_session_teacher(id))
with check (
  teacher_id = auth.uid()::text
  and exists (
    select 1 from public.activities as a
    where a.id = activity_id and a.teacher_id = auth.uid()::text
  )
);

create policy sessions_teacher_delete on public.sessions
for delete to authenticated
using (public.is_session_teacher(id));

create policy session_steps_scoped_read on public.session_steps
for select to authenticated
using (
  public.is_session_teacher(session_id) or public.is_session_participant(session_id)
);

create policy session_steps_teacher_write on public.session_steps
for all to authenticated
using (public.is_session_teacher(session_id))
with check (public.is_session_teacher(session_id));

create policy groups_scoped_read on public.groups
for select to authenticated
using (
  public.is_session_teacher(session_id) or public.is_group_participant(id)
);

create policy groups_teacher_insert on public.groups
for insert to authenticated
with check (public.is_session_teacher(session_id));

create policy groups_teacher_delete on public.groups
for delete to authenticated
using (public.is_session_teacher(session_id));

create policy group_members_scoped_read on public.group_members
for select to authenticated
using (
  public.is_group_participant(group_id)
  or exists (
    select 1 from public.groups as g
    where g.id = group_id and public.is_session_teacher(g.session_id)
  )
);

create policy group_members_teacher_write on public.group_members
for all to authenticated
using (
  exists (
    select 1 from public.groups as g
    where g.id = group_id and public.is_session_teacher(g.session_id)
  )
)
with check (
  exists (
    select 1 from public.groups as g
    where g.id = group_id and public.is_session_teacher(g.session_id)
  )
);

create policy utterances_teacher_read on public.utterances
for select to authenticated
using (public.is_session_teacher(session_id));

create policy group_insights_scoped_read on public.group_insights
for select to authenticated
using (
  public.is_session_teacher(session_id) or public.is_group_participant(group_id)
);

create policy help_requests_scoped_read on public.help_requests
for select to authenticated
using (
  public.is_session_teacher(session_id) or public.is_group_participant(group_id)
);

create policy roster_sets_teacher_all on public.roster_sets
for all to authenticated
using (teacher_id = auth.uid()::text)
with check (teacher_id = auth.uid()::text);

create policy roster_groups_teacher_all on public.roster_groups
for all to authenticated
using (
  teacher_id = auth.uid()::text
  and exists (
    select 1 from public.roster_sets as rs
    where rs.id = roster_set_id and rs.teacher_id = auth.uid()::text
  )
)
with check (
  teacher_id = auth.uid()::text
  and exists (
    select 1 from public.roster_sets as rs
    where rs.id = roster_set_id and rs.teacher_id = auth.uid()::text
  )
);

create policy roster_students_teacher_all on public.roster_students
for all to authenticated
using (
  exists (
    select 1 from public.roster_groups as rg
    where rg.id = roster_group_id and rg.teacher_id = auth.uid()::text
  )
)
with check (
  exists (
    select 1 from public.roster_groups as rg
    where rg.id = roster_group_id and rg.teacher_id = auth.uid()::text
  )
);

create policy classes_teacher_all on public.classes
for all to authenticated
using (teacher_id = auth.uid()::text)
with check (teacher_id = auth.uid()::text);

create policy class_students_teacher_all on public.class_students
for all to authenticated
using (
  exists (
    select 1 from public.classes as c
    where c.id = class_id and c.teacher_id = auth.uid()::text
  )
)
with check (
  exists (
    select 1 from public.classes as c
    where c.id = class_id and c.teacher_id = auth.uid()::text
  )
);

create policy class_relationship_rules_teacher_all on public.class_relationship_rules
for all to authenticated
using (
  exists (
    select 1 from public.classes as c
    where c.id = class_id and c.teacher_id = auth.uid()::text
  )
)
with check (
  exists (
    select 1 from public.classes as c
    where c.id = class_id and c.teacher_id = auth.uid()::text
  )
);

create policy class_formed_groups_teacher_all on public.class_formed_groups
for all to authenticated
using (
  exists (
    select 1 from public.classes as c
    where c.id = class_id and c.teacher_id = auth.uid()::text
  )
)
with check (
  exists (
    select 1 from public.classes as c
    where c.id = class_id and c.teacher_id = auth.uid()::text
  )
);

create policy class_formed_group_members_teacher_all on public.class_formed_group_members
for all to authenticated
using (
  exists (
    select 1
    from public.class_formed_groups as cfg
    join public.classes as c on c.id = cfg.class_id
    where cfg.id = formed_group_id and c.teacher_id = auth.uid()::text
  )
)
with check (
  exists (
    select 1
    from public.class_formed_groups as cfg
    join public.classes as c on c.id = cfg.class_id
    where cfg.id = formed_group_id and c.teacher_id = auth.uid()::text
  )
);

create or replace function public.get_session_join_preview(requested_join_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.sessions%rowtype;
begin
  if auth.uid() is null
     or coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true' then
    raise exception 'anonymous student authentication required' using errcode = '42501';
  end if;

  if requested_join_code is null or char_length(btrim(requested_join_code)) < 4 then
    raise exception 'invalid join code' using errcode = '22023';
  end if;

  select s.* into v_session
  from public.sessions as s
  where s.join_code = upper(btrim(requested_join_code));

  if not found then
    return null;
  end if;

  if v_session.status = 'ended' then
    return jsonb_build_object(
      'session', jsonb_build_object(
        'id', v_session.id,
        'title', v_session.title,
        'join_code', v_session.join_code,
        'status', v_session.status,
        'use_roster', false,
        'steps', '[]'::jsonb
      ),
      'groups', '[]'::jsonb
    );
  end if;

  if v_session.status not in ('waiting', 'active') then
    return null;
  end if;

  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'title', v_session.title,
      'join_code', v_session.join_code,
      'status', v_session.status,
      'use_roster', v_session.use_roster,
      'created_at', v_session.created_at,
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'steps', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('id', ss.id, 'position', ss.position, 'label', ss.label)
            order by ss.position
          ),
          '[]'::jsonb
        )
        from public.session_steps as ss
        where ss.session_id = v_session.id
      )
    ),
    'groups', case when v_session.use_roster then (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', g.id,
            'session_id', g.session_id,
            'name', g.name,
            'joined_at', g.joined_at,
            'members', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object('id', gm.id, 'name', gm.name)
                  order by gm.position, gm.id
                ),
                '[]'::jsonb
              )
              from public.group_members as gm
              where gm.group_id = g.id
            )
          ) order by g.name
        ),
        '[]'::jsonb
      )
      from public.groups as g
      where g.session_id = v_session.id
    ) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.set_participant_group_step(
  requested_group_id uuid,
  requested_step_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_group_participant(requested_group_id) then
    raise exception 'participant group access required' using errcode = '42501';
  end if;

  update public.groups as g
  set current_step_id = requested_step_id
  from public.sessions as s
  where g.id = requested_group_id
    and s.id = g.session_id
    and s.status = 'active'
    and exists (
      select 1 from public.session_steps as ss
      where ss.id = requested_step_id and ss.session_id = g.session_id
    );

  if not found then
    raise exception 'step is not available for active group' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.request_participant_help(
  requested_session_id uuid,
  requested_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_group_participant(requested_group_id) then
    raise exception 'participant group access required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.groups as g
    join public.sessions as s on s.id = g.session_id
    where g.id = requested_group_id
      and g.session_id = requested_session_id
      and s.status = 'active'
  ) then
    raise exception 'active participant group required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.help_requests as hr
    where hr.session_id = requested_session_id
      and hr.group_id = requested_group_id
      and hr.resolved_at is null
  ) then
    insert into public.help_requests (session_id, group_id)
    values (requested_session_id, requested_group_id);
  end if;
end;
$$;

create or replace function public.resolve_teacher_help(requested_help_request_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.help_requests as hr
  set resolved_at = statement_timestamp()
  where hr.id = requested_help_request_id
    and hr.resolved_at is null
    and public.is_session_teacher(hr.session_id);

  if not found then
    raise exception 'teacher help request access required' using errcode = '42501';
  end if;
end;
$$;

alter function public.get_session_join_preview(text) owner to postgres;
alter function public.set_participant_group_step(uuid, uuid) owner to postgres;
alter function public.request_participant_help(uuid, uuid) owner to postgres;
alter function public.resolve_teacher_help(uuid) owner to postgres;

revoke all on function public.get_session_join_preview(text) from public, anon, authenticated;
revoke all on function public.set_participant_group_step(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_participant_help(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_teacher_help(uuid) from public, anon, authenticated;

grant execute on function public.get_session_join_preview(text) to authenticated;
grant execute on function public.set_participant_group_step(uuid, uuid) to authenticated;
grant execute on function public.request_participant_help(uuid, uuid) to authenticated;
grant execute on function public.resolve_teacher_help(uuid) to authenticated;
