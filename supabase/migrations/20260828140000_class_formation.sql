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

-- 학급당 현재 확정 모둠만 유지 (기록 보관 없음)
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

alter table classes                    enable row level security;
alter table class_students             enable row level security;
alter table class_relationship_rules   enable row level security;
alter table class_formed_groups        enable row level security;
alter table class_formed_group_members enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'classes',
    'class_students',
    'class_relationship_rules',
    'class_formed_groups',
    'class_formed_group_members'
  ]
  loop
    begin
      execute format(
        'create policy %I on %I for all to anon, authenticated using (true) with check (true)',
        t || '_anon_all',
        t
      );
    exception
      when duplicate_object then null;
    end;
    execute format(
      'grant select, insert, update, delete on table %I to anon, authenticated',
      t
    );
  end loop;
end $$;
