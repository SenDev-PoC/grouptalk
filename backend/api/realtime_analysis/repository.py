import json
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ParticipationInsight, UtteranceObservation

LOAD_ANALYSIS_WINDOW_QUERY = text(
    """
    with latest as (
      select max(spoken_at) as spoken_at
      from utterances
      where session_id = :session_id
        and group_id = :group_id
        and data_source = 'live'
    )
    select utterances.id, utterances.speaker_label,
           utterances.spoken_at, utterances.created_at
    from utterances
    cross join latest
    where utterances.session_id = :session_id
      and utterances.group_id = :group_id
      and utterances.data_source = 'live'
      and utterances.spoken_at >= latest.spoken_at - interval '5 minutes'
      and utterances.spoken_at <= latest.spoken_at
    order by utterances.spoken_at desc, utterances.created_at desc, utterances.id desc
    limit 20
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
      'live',
      now()
    )
    on conflict (group_id) do update set
      session_id = excluded.session_id,
      participation_state = excluded.participation_state,
      speaker_shares = excluded.speaker_shares,
      off_topic_ratio = excluded.off_topic_ratio,
      off_topic_evidence = excluded.off_topic_evidence,
      summary = excluded.summary,
      keywords = excluded.keywords,
      data_sufficiency = excluded.data_sufficiency,
      judgability = excluded.judgability,
      reason_code = excluded.reason_code,
      evidence_from = excluded.evidence_from,
      evidence_to = excluded.evidence_to,
      observation_count = excluded.observation_count,
      analysis_version = excluded.analysis_version,
      data_source = excluded.data_source,
      updated_at = excluded.updated_at
    where (
      group_insights.session_id,
      group_insights.participation_state,
      group_insights.speaker_shares,
      group_insights.off_topic_ratio,
      group_insights.off_topic_evidence,
      group_insights.summary,
      group_insights.keywords,
      group_insights.data_sufficiency,
      group_insights.judgability,
      group_insights.reason_code,
      group_insights.evidence_from,
      group_insights.evidence_to,
      group_insights.observation_count,
      group_insights.analysis_version,
      group_insights.data_source
    ) is distinct from (
      excluded.session_id,
      excluded.participation_state,
      excluded.speaker_shares,
      excluded.off_topic_ratio,
      excluded.off_topic_evidence,
      excluded.summary,
      excluded.keywords,
      excluded.data_sufficiency,
      excluded.judgability,
      excluded.reason_code,
      excluded.evidence_from,
      excluded.evidence_to,
      excluded.observation_count,
      excluded.analysis_version,
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


async def upsert_group_insight(
    db: AsyncSession,
    session_id: UUID,
    group_id: UUID,
    insight: ParticipationInsight,
) -> bool:
    speaker_shares = json.dumps(
        [
            {
                "speaker_label": share.speaker_label,
                "ratio": share.ratio,
                "utterance_count": share.utterance_count,
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
        },
    )
    return result.mappings().one_or_none() is not None
