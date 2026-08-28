-- Presence는 anonymous Auth 사용자에게 발급된 해당 모둠 기기 키로만 갱신한다.

revoke all
on function public.report_group_presence(uuid, text)
from public, anon, authenticated;

drop function if exists public.report_group_presence(uuid, text);

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
  join public.sessions as s
    on s.id = ds.session_id
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
  set connection_state = requested_connection_state,
      last_seen_at = v_now
  where g.id = requested_group_id
    and g.session_id = v_session_id;

  if not found then
    raise exception 'active group not found' using errcode = 'P0002';
  end if;
end;
$$;

alter function public.report_group_presence(uuid, text, text) owner to postgres;

revoke all
on function public.report_group_presence(uuid, text, text)
from public, anon, authenticated;

grant execute
on function public.report_group_presence(uuid, text, text)
to authenticated;

comment on function public.report_group_presence(uuid, text, text) is
  'Updates presence only for the active anonymous Auth participant and its server-issued group device key.';
