-- Ensure roster set tables exist (활동 시작 배정 동기화용).
-- 원격 DB에 roster_sets 가 없어도 안전하게 생성한다.

create table if not exists roster_sets (
  id         uuid primary key default gen_random_uuid(),
  teacher_id text not null,
  name       text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists roster_groups (
  id            uuid primary key default gen_random_uuid(),
  roster_set_id uuid references roster_sets (id) on delete cascade,
  teacher_id    text not null,
  name          text not null,
  position      int  not null default 0
);

-- 구스키마(roster_set_id 없음)에서 올라온 경우 컬럼 보강
alter table roster_groups
  add column if not exists roster_set_id uuid references roster_sets (id) on delete cascade;

do $$
declare
  tid text;
  sid uuid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'roster_groups'
      and column_name = 'roster_set_id'
  ) then
    for tid in
      select distinct teacher_id
      from roster_groups
      where roster_set_id is null
    loop
      insert into roster_sets (teacher_id, name, position)
      values (tid, '기본 편성', 0)
      returning id into sid;

      update roster_groups
      set roster_set_id = sid
      where teacher_id = tid and roster_set_id is null;
    end loop;
  end if;
end $$;

-- set 없는 orphan 행이 없을 때만 not null 강제
do $$
begin
  if not exists (select 1 from roster_groups where roster_set_id is null) then
    alter table roster_groups alter column roster_set_id set not null;
  end if;
exception
  when others then null;
end $$;

create table if not exists roster_students (
  id              uuid primary key default gen_random_uuid(),
  roster_group_id uuid not null references roster_groups (id) on delete cascade,
  name            text not null,
  position        int  not null default 0
);

create index if not exists roster_sets_teacher_idx on roster_sets (teacher_id, position);
create index if not exists roster_groups_set_idx on roster_groups (roster_set_id, position);
create index if not exists roster_students_group_idx on roster_students (roster_group_id, position);

alter table roster_sets     enable row level security;
alter table roster_groups   enable row level security;
alter table roster_students enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['roster_sets', 'roster_groups', 'roster_students']
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
