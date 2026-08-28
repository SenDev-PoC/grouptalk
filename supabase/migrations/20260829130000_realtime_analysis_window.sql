-- 새 live 전사마다 같은 session/group의 최근 5분·최대 20건을 안정적으로 읽는다.
create index if not exists utterances_live_analysis_window_idx
  on utterances (session_id, group_id, spoken_at desc, created_at desc, id desc)
  where data_source = 'live';
