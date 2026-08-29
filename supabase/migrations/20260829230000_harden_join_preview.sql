-- 입장 미리보기에서 교사 ID·활동 ID·다른 모둠 실시간 상태를 빼고,
-- 종료된 활동의 명단이 나가지 않게 한다.

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

alter function public.get_session_join_preview(text) owner to postgres;

revoke all on function public.get_session_join_preview(text) from public, anon, authenticated;
grant execute on function public.get_session_join_preview(text) to authenticated;

comment on function public.get_session_join_preview(text) is
  'Returns joinable session fields for anonymous students without teacher identifiers or live group telemetry.';
