-- 실제 발화 시간을 보존하고 모둠별 참여 편중의 지속 상태를 현재 projection에 기록한다.
-- timing이 없는 기존 live 행과 migration/API 순차 배포 중 구버전 worker를 허용한다.
-- 새 API 계약은 timing을 필수로 검증하므로 새 버전 배포 후에는 유효한 값만 저장된다.

alter table utterances
  add column start_ms bigint,
  add column end_ms bigint;

alter table utterances
  add constraint utterances_timing_shape_check check (
    (data_source = 'synthetic' and start_ms is null and end_ms is null)
    or
    (
      data_source = 'live'
      and (
        (start_ms is null and end_ms is null)
        or
        (
          start_ms is not null
          and end_ms is not null
          and start_ms >= 0
          and end_ms > start_ms
        )
      )
    )
  );

alter table group_insights
  add column participation_equity numeric,
  add column total_speaking_ms bigint,
  add column joined_participant_count int,
  add column silent_participant_count int,
  add column participation_alert_state text not null default 'NORMAL',
  add column alert_pending_since timestamptz,
  add column alert_active_since timestamptz,
  add column alert_recovery_since timestamptz,
  add column alert_cooldown_until timestamptz,
  add column alert_last_observed_at timestamptz;

alter table group_insights
  add constraint group_insights_equity_check check (
    participation_equity is null
    or (participation_equity >= 0 and participation_equity <= 1)
  ),
  add constraint group_insights_participant_counts_check check (
    (
      total_speaking_ms is null
      and silent_participant_count is null
      and (joined_participant_count is null or joined_participant_count > 0)
    )
    or
    (
      total_speaking_ms is not null and total_speaking_ms >= 0
      and joined_participant_count is not null and joined_participant_count > 0
      and silent_participant_count is not null and silent_participant_count >= 0
      and silent_participant_count <= joined_participant_count
    )
  ),
  add constraint group_insights_alert_state_check check (
    participation_alert_state in ('NORMAL', 'PENDING', 'ACTIVE')
  ),
  add constraint group_insights_alert_state_shape_check check (
    (
      participation_alert_state = 'NORMAL'
      and alert_pending_since is null
      and alert_active_since is null
      and alert_recovery_since is null
    )
    or
    (
      participation_alert_state = 'PENDING'
      and alert_pending_since is not null
      and alert_active_since is null
      and alert_recovery_since is null
      and alert_cooldown_until is null
    )
    or
    (
      participation_alert_state = 'ACTIVE'
      and alert_pending_since is null
      and alert_active_since is not null
      and alert_cooldown_until is null
    )
  );
