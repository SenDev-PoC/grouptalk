-- 의미 분석 provider가 일시적으로 실패한 동일 window를 제한적으로 재시도한다.

alter table group_insights
  add column analysis_retry_count integer not null default 0,
  add column analysis_retry_after timestamptz,
  add column analysis_last_error_code text;

alter table group_insights
  add constraint group_insights_analysis_retry_count_check check (
    analysis_retry_count >= 0
  ),
  add constraint group_insights_analysis_retry_shape_check check (
    analysis_retry_after is null
    or (analysis_status = 'failed' and analysis_retry_count > 0)
  );
