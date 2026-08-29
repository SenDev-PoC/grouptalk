-- 학생 anonymous Auth 사용자와 실제 모둠 기기 세대를 원자적으로 연결한다.

alter table public.device_sessions
  add column if not exists auth_user_id uuid;

alter table public.device_sessions
  add constraint device_sessions_auth_user_fk
  foreign key (auth_user_id)
  references auth.users (id)
  on delete cascade;

create index if not exists device_sessions_auth_user_idx
  on public.device_sessions (auth_user_id, session_id)
  where auth_user_id is not null and ended_at is null;

create table if not exists public.session_participants (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid not null references auth.users (id) on delete cascade,
  session_id        uuid not null,
  group_id          uuid not null,
  device_session_id uuid not null,
  joined_at         timestamptz not null default now(),
  ended_at          timestamptz,
  constraint session_participants_device_fk
    foreign key (session_id, group_id, device_session_id)
    references public.device_sessions (session_id, group_id, id)
    on delete cascade,
  constraint session_participants_end_check
    check (ended_at is null or ended_at >= joined_at)
);

create unique index if not exists session_participants_one_active_user
  on public.session_participants (session_id, auth_user_id)
  where ended_at is null;

create unique index if not exists session_participants_one_device
  on public.session_participants (device_session_id);

alter table public.session_participants enable row level security;

revoke all on table public.session_participants from anon, authenticated;
revoke select (auth_user_id) on table public.device_sessions from anon, authenticated;

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

  select s.*
  into v_session
  from public.sessions as s
  where s.join_code = upper(btrim(requested_join_code))
    and s.status in ('waiting', 'active')
  for update;

  if not found then
    raise exception 'session is not joinable' using errcode = 'P0002';
  end if;

  -- 같은 anonymous Auth 세션의 재입장은 기존 기기 키와 모둠만 되돌려 준다.
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
    select g.*
    into v_group
    from public.groups as g
    where g.id = v_existing_group_id
      and g.session_id = v_session.id;

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

    select g.*
    into v_group
    from public.groups as g
    where g.id = requested_existing_group_id
      and g.session_id = v_session.id
    for update;

    if not found
       or v_group.joined_at is not null
       or v_group.name <> btrim(requested_group_name) then
      raise exception 'roster group is unavailable' using errcode = '42501';
    end if;

    update public.groups as g
    set joined_at = v_now,
        last_seen_at = v_now,
        connection_state = 'not_ready'
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
         select 1
         from unnest(v_member_names) as member_name
         where char_length(member_name) > 100
       ) then
      raise exception 'invalid member names' using errcode = '22023';
    end if;

    insert into public.groups (
      session_id, name, joined_at, last_seen_at, connection_state
    ) values (
      v_session.id, btrim(requested_group_name), v_now, v_now, 'not_ready'
    )
    returning * into v_group;

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
    session_id,
    group_id,
    auth_user_id,
    client_device_key,
    generation,
    readiness_state,
    connection_state,
    collection_state,
    last_seen_at,
    confirmed_at
  ) values (
    v_session.id,
    v_group.id,
    v_auth_user_id,
    v_device_key,
    1,
    'ready',
    'disconnected',
    'idle',
    v_now,
    v_now
  )
  returning id into v_device_session_id;

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

revoke all
on function public.join_session_group(text, text, text[], uuid)
from public, anon, authenticated;

grant execute
on function public.join_session_group(text, text, text[], uuid)
to authenticated;

comment on function public.join_session_group(text, text, text[], uuid) is
  'Atomically joins an anonymous Auth student to one group and issues its server-generated device key.';
