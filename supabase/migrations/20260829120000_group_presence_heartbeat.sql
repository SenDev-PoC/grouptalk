-- 공용 기기 heartbeat는 브라우저 시계가 아니라 PostgreSQL 시계로 기록한다.

create or replace function public.report_group_presence(
  requested_group_id uuid,
  requested_connection_state text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if requested_connection_state not in ('not_ready', 'connecting', 'live', 'lost') then
    raise exception 'invalid group connection state: %', requested_connection_state;
  end if;

  update public.groups
  set
    connection_state = requested_connection_state,
    last_seen_at = now()
  where id = requested_group_id;

  if not found then
    raise exception 'group not found: %', requested_group_id using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.report_group_presence(uuid, text) from public;
grant execute on function public.report_group_presence(uuid, text) to anon, authenticated;

comment on function public.report_group_presence(uuid, text) is
  'Updates group presence using the database clock so teacher freshness checks do not depend on device time.';
