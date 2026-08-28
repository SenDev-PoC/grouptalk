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
  speaker_label   text not null,
  text            text not null,
  data_source     text not null default 'synthetic',
  source_event_id text,
  spoken_at       timestamptz not null default now(),
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
  )
);

create index if not exists utterances_session_idx on utterances (session_id, spoken_at);

create unique index if not exists utterances_live_event_key
  on utterances (session_id, group_id, source_event_id)
  where source_event_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 참여 분석 결과. 백엔드(LLM)가 모둠당 1행을 upsert 한다.
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
  constraint group_insights_live_text_check check (
    data_source <> 'live'
    or (
      summary is null
      and keywords = '{}'::text[]
      and off_topic_evidence = '[]'::jsonb
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
-- 아래는 해커톤 시연을 굴리기 위한 최소 설정이며 보안 결정이 아니다.
-- 교사 인증과 세션 범위 제한은 백엔드 담당자가 정해야 한다.
-- 실제 학생 데이터에는 이 정책을 그대로 쓰지 않는다.
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
alter table conversation_observations enable row level security;
alter table command_receipts enable row level security;

-- 서버 전용 테이블에는 demo_open 정책을 만들지 않는다. FastAPI가 DB 쓰기를
-- 소유하며 LiveKit worker는 FastAPI private API를 통해서만 상태를 변경한다.

do $$
declare
  target text;
begin
  foreach target in array array[
    'activities', 'activity_steps', 'sessions', 'session_steps', 'groups',
    'group_members', 'utterances', 'group_insights', 'help_requests',
    'roster_sets', 'roster_groups', 'roster_students',
    'classes', 'class_students', 'class_relationship_rules',
    'class_formed_groups', 'class_formed_group_members'
  ]
  loop
    execute format(
      'create policy %I on %I for all to anon, authenticated using (true) with check (true)',
      'demo_open_' || target, target
    );
    -- 최신 Supabase 프로젝트는 새 public 테이블을 Data API 역할에 자동으로
    -- 노출하지 않으므로 RLS 정책과 별도로 테이블 권한을 명시해야 한다.
    execute format(
      'grant select, insert, update, delete on table %I to anon, authenticated',
      target
    );
  end loop;
end $$;
