-- 데모 전체 공개 정책을 제거하고 교사 소유권·학생 참여자 범위로 격리한다.

-- 구버전 DB의 group_set_id 기반 확정 편성을 현재 class_id 계약으로 보강한다.
alter table public.class_formed_groups
  add column if not exists class_id uuid references public.classes (id) on delete cascade;

do $$
begin
  if to_regclass('public.class_group_sets') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'class_formed_groups'
         and column_name = 'group_set_id'
     ) then
    execute '
      update public.class_formed_groups as cfg
      set class_id = cgs.class_id
      from public.class_group_sets as cgs
      where cgs.id = cfg.group_set_id and cfg.class_id is null
    ';
    execute 'alter table public.class_formed_groups alter column group_set_id drop not null';
  end if;
end;
$$;

alter table public.class_formed_groups alter column class_id set not null;
create index if not exists class_formed_groups_class_idx
  on public.class_formed_groups (class_id, position);

drop policy if exists demo_open_activities on public.activities;
drop policy if exists demo_open_activity_steps on public.activity_steps;
drop policy if exists demo_open_sessions on public.sessions;
drop policy if exists demo_open_session_steps on public.session_steps;
drop policy if exists demo_open_groups on public.groups;
drop policy if exists demo_open_group_members on public.group_members;
drop policy if exists demo_open_help_requests on public.help_requests;
drop policy if exists demo_open_roster_sets on public.roster_sets;
drop policy if exists demo_open_roster_groups on public.roster_groups;
drop policy if exists demo_open_roster_students on public.roster_students;
drop policy if exists demo_open_classes on public.classes;
drop policy if exists demo_open_class_students on public.class_students;
drop policy if exists demo_open_class_relationship_rules on public.class_relationship_rules;
drop policy if exists demo_open_class_formed_groups on public.class_formed_groups;
drop policy if exists demo_open_class_formed_group_members on public.class_formed_group_members;
drop policy if exists utterances_demo_read on public.utterances;
drop policy if exists group_insights_demo_read on public.group_insights;
drop policy if exists roster_sets_anon_all on public.roster_sets;
drop policy if exists roster_groups_anon_all on public.roster_groups;
drop policy if exists roster_students_anon_all on public.roster_students;
drop policy if exists classes_anon_all on public.classes;
drop policy if exists class_students_anon_all on public.class_students;
drop policy if exists class_relationship_rules_anon_all on public.class_relationship_rules;
drop policy if exists class_formed_groups_anon_all on public.class_formed_groups;
drop policy if exists class_formed_group_members_anon_all on public.class_formed_group_members;

do $$
begin
  if to_regclass('public.class_group_sets') is not null then
    execute 'drop policy if exists class_group_sets_anon_all on public.class_group_sets';
    execute 'revoke all on table public.class_group_sets from anon, authenticated';
  end if;
end;
$$;

create or replace function public.is_session_teacher(requested_session_id uuid)
returns boolean
language sql
stable
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
  public.is_session_teacher(id) or public.is_session_participant(id)
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

  select s.* into v_session
  from public.sessions as s
  where s.join_code = upper(btrim(requested_join_code));

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'activity_id', v_session.activity_id,
      'teacher_id', v_session.teacher_id,
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
            'current_step_id', g.current_step_id,
            'connection_state', g.connection_state,
            'last_seen_at', g.last_seen_at,
            'members', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object('id', gm.id, 'name', gm.name, 'position', gm.position)
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
