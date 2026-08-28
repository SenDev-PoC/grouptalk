-- 별도 의미 분석 worker가 참여도 projection을 덮어쓰지 않고 최신 의미 결과만 기록한다.

alter table group_insights
  drop constraint group_insights_live_text_check;

alter table group_insights
  add column topic_relevance text,
  add column analysis_status text not null default 'idle',
  add column analysis_confidence numeric,
  add column analysis_source_utterance_id uuid,
  add column analysis_attempted_at timestamptz;

alter table group_insights
  add constraint group_insights_topic_relevance_check check (
    topic_relevance is null or topic_relevance in ('on_topic', 'mixed', 'off_topic')
  ),
  add constraint group_insights_analysis_status_check check (
    analysis_status in ('idle', 'completed', 'insufficient', 'failed')
  ),
  add constraint group_insights_analysis_confidence_check check (
    analysis_confidence is null
    or (analysis_confidence >= 0 and analysis_confidence <= 1)
  ),
  add constraint group_insights_completed_analysis_check check (
    analysis_status <> 'completed'
    or (
      topic_relevance is not null
      and summary is not null and char_length(btrim(summary)) > 0
      and cardinality(keywords) between 1 and 6
      and analysis_confidence is not null
      and analysis_source_utterance_id is not null
      and analysis_attempted_at is not null
    )
  );
