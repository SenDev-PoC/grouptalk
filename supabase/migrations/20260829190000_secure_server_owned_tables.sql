-- utterances와 group_insights는 서버가 생성하는 데이터다.
-- 인증 기반 행 읽기 격리 전까지 기존 demo 조회는 유지하되,
-- Data API client가 내용을 위조하지 못하도록 쓰기 권한을 회수한다.

drop policy if exists demo_open_utterances on public.utterances;
drop policy if exists demo_open_group_insights on public.group_insights;
drop policy if exists utterances_demo_read on public.utterances;
drop policy if exists group_insights_demo_read on public.group_insights;

revoke insert, update, delete
on table public.utterances
from anon, authenticated;

revoke insert, update, delete
on table public.group_insights
from anon, authenticated;

grant select
on table public.utterances
to anon, authenticated;

grant select
on table public.group_insights
to anon, authenticated;

create policy utterances_demo_read
on public.utterances
for select
to anon, authenticated
using (true);

create policy group_insights_demo_read
on public.group_insights
for select
to anon, authenticated
using (true);
