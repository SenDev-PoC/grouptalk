-- 모둠뷰 프론트엔드가 기대하는 스키마 계약
--
-- 이 파일은 프론트엔드가 읽고 쓰는 테이블·컬럼의 형태를 고정하기 위한 것이다.
-- 실제 백엔드 구현(전사 파이프라인, 분석, 인증, RLS 정책)은 백엔드 담당자가 정한다.
-- 컬럼 이름과 값의 범위만 유지하면 내부 구조는 바꿔도 된다.

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
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  ended_at    timestamptz
);

-- 세션 시점의 단계 스냅샷. 활동 템플릿이 나중에 바뀌어도 기록이 흔들리지 않는다.
create table if not exists session_steps (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  position   int  not null,
  label      text not null
);

-- ─────────────────────────────────────────────────────────────
-- 모둠. 모둠당 공용 기기 한 대를 전제한다.
-- joined_at 이 null 이면 아직 들어오지 않은 모둠(교사가 미리 배정만 해 둔 상태).
-- ─────────────────────────────────────────────────────────────
create table if not exists groups (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references sessions (id) on delete cascade,
  name             text not null,
  joined_at        timestamptz,
  current_step_id  uuid references session_steps (id) on delete set null,
  connection_state text not null default 'not_ready'
                   check (connection_state in ('not_ready', 'connecting', 'live', 'lost')),
  -- 학생 기기가 8초마다 갱신한다. 교사 화면은 이 값으로 연결 실패를 판정한다.
  last_seen_at     timestamptz
);

create table if not exists group_members (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  name     text not null,
  position int  not null default 0
);

-- ─────────────────────────────────────────────────────────────
-- 전사문. 백엔드(Deepgram)가 쓰고 프론트엔드는 리포트에서 읽기만 한다.
-- speaker_label 은 익명 화자 표시이며 학생 이름과 연결하지 않는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists utterances (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions (id) on delete cascade,
  group_id      uuid not null references groups (id) on delete cascade,
  speaker_label text not null,
  text          text not null,
  spoken_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists utterances_session_idx on utterances (session_id, spoken_at);

-- ─────────────────────────────────────────────────────────────
-- 참여 분석 결과. 백엔드(LLM)가 모둠당 1행을 upsert 한다.
-- 프론트엔드는 절대 쓰지 않고 realtime 으로 구독만 한다.
-- ─────────────────────────────────────────────────────────────
create table if not exists group_insights (
  group_id            uuid primary key references groups (id) on delete cascade,
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
  -- 이 값이 45초 이상 오래되면 교사 화면은 '갱신 중단'으로 표시한다.
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 학생이 누른 도움 요청. 교사 화면에 누른 순서대로 뜬다.
-- ─────────────────────────────────────────────────────────────
create table if not exists help_requests (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions (id) on delete cascade,
  group_id    uuid not null references groups (id) on delete cascade,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- 학생 관리 탭에서 미리 저장하는 모둠 배정
-- ─────────────────────────────────────────────────────────────
create table if not exists roster_groups (
  id         uuid primary key default gen_random_uuid(),
  teacher_id text not null,
  name       text not null,
  position   int  not null default 0
);

create table if not exists roster_students (
  id              uuid primary key default gen_random_uuid(),
  roster_group_id uuid not null references roster_groups (id) on delete cascade,
  name            text not null,
  position        int  not null default 0
);

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
alter table roster_groups   enable row level security;
alter table roster_students enable row level security;

do $$
declare
  target text;
begin
  foreach target in array array[
    'activities', 'activity_steps', 'sessions', 'session_steps', 'groups',
    'group_members', 'utterances', 'group_insights', 'help_requests',
    'roster_groups', 'roster_students'
  ]
  loop
    execute format(
      'create policy %I on %I for all to anon, authenticated using (true) with check (true)',
      'demo_open_' || target, target
    );
  end loop;
end $$;
