-- 모둠 배정 세트: 교사가 여러 편성을 저장하고 시작 시 고른다.
create table if not exists roster_sets (
  id         uuid primary key default gen_random_uuid(),
  teacher_id text not null,
  name       text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);

alter table roster_groups
  add column if not exists roster_set_id uuid references roster_sets (id) on delete cascade;

-- 기존 단일 편성 행을 교사별 기본 세트로 옮긴다.
do $$
declare
  tid text;
  sid uuid;
begin
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
end $$;

alter table roster_groups
  alter column roster_set_id set not null;

create index if not exists roster_sets_teacher_idx on roster_sets (teacher_id, position);
create index if not exists roster_groups_set_idx on roster_groups (roster_set_id, position);

alter table roster_sets enable row level security;
