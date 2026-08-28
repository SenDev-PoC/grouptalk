import json
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .alerts import ParticipationAlertState
from .models import ParticipationInsight, UtteranceObservation

LOAD_ANALYSIS_WINDOW_QUERY = text(
    """
    with latest as (
      select max(spoken_at) as spoken_at
      from utterances
      where session_id = :session_id
        and group_id = :group_id
        and data_source = 'live'
        and start_ms is not null
        and end_ms is not null
    )
    select utterances.id, utterances.speaker_label,
           utterances.spoken_at, utterances.created_at,
           utterances.start_ms, utterances.end_ms
    from utterances
    cross join latest
    where utterances.session_id = :session_id
      and utterances.group_id = :group_id
      and utterances.data_source = 'live'
      and utterances.start_ms is not null
      and utterances.end_ms is not null
      and utterances.spoken_at >= latest.spoken_at - interval '120 seconds'
      and utterances.spoken_at <= latest.spoken_at
    order by utterances.spoken_at desc, utterances.created_at desc, utterances.id desc
    """
)

LOAD_GROUP_MEMBER_COUNT_QUERY = text(
    "select count(*) from group_members where group_id = :group_id"
)

LOAD_ALERT_STATE_QUERY = text(
    """
    select participation_alert_state, alert_pending_since, alert_active_since,
           alert_recovery_since, alert_cooldown_until, alert_last_observed_at
    from group_insights
    where session_id = :session_id and group_id = :group_id
    """
)

UPSERT_GROUP_INSIGHT_QUERY = text(
    """
    insert into group_insights (
      group_id,
      session_id,
      participation_state,
      speaker_shares,
      off_topic_ratio,
      off_topic_evidence,
      summary,
      keywords,
      data_sufficiency,
      judgability,
      reason_code,
      evidence_from,
      evidence_to,
      observation_count,
      analysis_version,
      participation_equity,
      total_speaking_ms,
      joined_participant_count,
      silent_participant_count,
      participation_alert_state,
      alert_pending_since,
      alert_active_since,
      alert_recovery_since,
      alert_cooldown_until,
      alert_last_observed_at,
      data_source,
      updated_at
    ) values (
      :group_id,
      :session_id,
      :participation_state,
      cast(:speaker_shares as jsonb),
      null,
      '[]'::jsonb,
      null,
      '{}'::text[],
      :data_sufficiency,
      :judgability,
      :reason_code,
      :evidence_from,
      :evidence_to,
      :observation_count,
      :analysis_version,
      :participation_equity,
      :total_speaking_ms,
      :joined_participant_count,
      :silent_participant_count,
      :participation_alert_state,
      :alert_pending_since,
      :alert_active_since,
      :alert_recovery_since,
      :alert_cooldown_until,
      :alert_last_observed_at,
      'live',
      now()
    )
    on conflict (group_id) do update set
      session_id = excluded.session_id,
      participation_state = excluded.participation_state,
      speaker_shares = excluded.speaker_shares,
      data_sufficiency = excluded.data_sufficiency,
      judgability = excluded.judgability,
      reason_code = excluded.reason_code,
      evidence_from = excluded.evidence_from,
      evidence_to = excluded.evidence_to,
      observation_count = excluded.observation_count,
      analysis_version = excluded.analysis_version,
      participation_equity = excluded.participation_equity,
      total_speaking_ms = excluded.total_speaking_ms,
      joined_participant_count = excluded.joined_participant_count,
      silent_participant_count = excluded.silent_participant_count,
      participation_alert_state = excluded.participation_alert_state,
      alert_pending_since = excluded.alert_pending_since,
      alert_active_since = excluded.alert_active_since,
      alert_recovery_since = excluded.alert_recovery_since,
      alert_cooldown_until = excluded.alert_cooldown_until,
      alert_last_observed_at = excluded.alert_last_observed_at,
      data_source = excluded.data_source,
      updated_at = excluded.updated_at
    where (
      group_insights.session_id,
      group_insights.participation_state,
      group_insights.speaker_shares,
      group_insights.data_sufficiency,
      group_insights.judgability,
      group_insights.reason_code,
      group_insights.evidence_from,
      group_insights.evidence_to,
      group_insights.observation_count,
      group_insights.analysis_version,
      group_insights.participation_equity,
      group_insights.total_speaking_ms,
      group_insights.joined_participant_count,
      group_insights.silent_participant_count,
      group_insights.participation_alert_state,
      group_insights.alert_pending_since,
      group_insights.alert_active_since,
      group_insights.alert_recovery_since,
      group_insights.alert_cooldown_until,
      group_insights.alert_last_observed_at,
      group_insights.data_source
    ) is distinct from (
      excluded.session_id,
      excluded.participation_state,
      excluded.speaker_shares,
      excluded.data_sufficiency,
      excluded.judgability,
      excluded.reason_code,
      excluded.evidence_from,
      excluded.evidence_to,
      excluded.observation_count,
      excluded.analysis_version,
      excluded.participation_equity,
      excluded.total_speaking_ms,
      excluded.joined_participant_count,
      excluded.silent_participant_count,
      excluded.participation_alert_state,
      excluded.alert_pending_since,
      excluded.alert_active_since,
      excluded.alert_recovery_since,
      excluded.alert_cooldown_until,
      excluded.alert_last_observed_at,
      excluded.data_source
    )
    returning group_id
    """
)


async def load_analysis_window(
    db: AsyncSession,
    session_id: UUID,
    group_id: UUID,
) -> tuple[UtteranceObservation, ...]:
    result = await db.execute(
        LOAD_ANALYSIS_WINDOW_QUERY,
        {"session_id": session_id, "group_id": group_id},
    )
    return tuple(UtteranceObservation(**row) for row in result.mappings().all())


async def load_group_member_count(db: AsyncSession, group_id: UUID) -> int:
    result = await db.execute(LOAD_GROUP_MEMBER_COUNT_QUERY, {"group_id": group_id})
    return int(result.scalar_one())


async def load_participation_alert_state(
    db: AsyncSession,
    session_id: UUID,
    group_id: UUID,
) -> ParticipationAlertState:
    result = await db.execute(
        LOAD_ALERT_STATE_QUERY,
        {"session_id": session_id, "group_id": group_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        return ParticipationAlertState.initial()
    return ParticipationAlertState(
        status=row["participation_alert_state"],
        pending_since=row["alert_pending_since"],
        active_since=row["alert_active_since"],
        recovery_since=row["alert_recovery_since"],
        cooldown_until=row["alert_cooldown_until"],
        last_observed_at=row["alert_last_observed_at"],
    )


async def upsert_group_insight(
    db: AsyncSession,
    session_id: UUID,
    group_id: UUID,
    insight: ParticipationInsight,
    alert_state: ParticipationAlertState,
) -> bool:
    speaker_shares = json.dumps(
        [
            {
                "speaker_label": share.speaker_label,
                "ratio": share.ratio,
                "utterance_count": share.utterance_count,
                "speaking_time_ms": share.speaking_time_ms,
            }
            for share in insight.speaker_shares
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    result = await db.execute(
        UPSERT_GROUP_INSIGHT_QUERY,
        {
            "group_id": group_id,
            "session_id": session_id,
            "participation_state": insight.participation_state,
            "speaker_shares": speaker_shares,
            "data_sufficiency": insight.data_sufficiency,
            "judgability": insight.judgability,
            "reason_code": insight.reason_code,
            "evidence_from": insight.evidence_from,
            "evidence_to": insight.evidence_to,
            "observation_count": insight.observation_count,
            "analysis_version": insight.analysis_version,
            "participation_equity": insight.participation_equity,
            "total_speaking_ms": insight.total_speaking_ms,
            "joined_participant_count": insight.joined_participant_count,
            "silent_participant_count": insight.silent_participant_count,
            "participation_alert_state": alert_state.status,
            "alert_pending_since": alert_state.pending_since,
            "alert_active_since": alert_state.active_since,
            "alert_recovery_since": alert_state.recovery_since,
            "alert_cooldown_until": alert_state.cooldown_until,
            "alert_last_observed_at": alert_state.last_observed_at,
        },
    )
    return result.mappings().one_or_none() is not None
