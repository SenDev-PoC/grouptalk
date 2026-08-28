-- Deepgram final transcript를 기존 synthetic 전사와 함께 저장한다.
-- source_event_id는 worker 재시도의 멱등 키이며 live 행에만 존재한다.

alter table utterances
  add column source_event_id text;

alter table utterances
  drop constraint utterances_data_source_check;

alter table utterances
  add constraint utterances_data_source_check
  check (data_source in ('synthetic', 'live'));

alter table utterances
  add constraint utterances_source_event_shape_check check (
    (data_source = 'synthetic' and source_event_id is null)
    or
    (
      data_source = 'live'
      and source_event_id is not null
      and char_length(source_event_id) between 1 and 128
    )
  );

create unique index utterances_live_event_key
  on utterances (session_id, group_id, source_event_id)
  where source_event_id is not null;
