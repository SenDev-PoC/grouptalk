-- INSERT … RETURNING evaluates SELECT policies in the same statement.
-- STABLE is_session_teacher() snapshots `sessions` without the new row, so
-- PostgREST returns 403 even when INSERT WITH CHECK passed.

create or replace function public.is_session_teacher(requested_session_id uuid)
returns boolean
language sql
volatile
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

drop policy if exists sessions_scoped_read on public.sessions;
create policy sessions_scoped_read on public.sessions
for select to authenticated
using (
  (
    coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
    and teacher_id = auth.uid()::text
  )
  or public.is_session_participant(id)
);
