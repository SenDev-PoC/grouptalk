from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from .alerts import advance_participation_alert
from .policy import build_participation_insight
from .repository import (
    load_analysis_window,
    load_group_member_count,
    load_participation_alert_state,
    upsert_group_insight,
)


async def project_realtime_participation(
    db: AsyncSession,
    session_id: UUID,
    group_id: UUID,
) -> bool:
    observations = await load_analysis_window(db, session_id, group_id)
    member_count = await load_group_member_count(db, group_id)
    insight = build_participation_insight(
        observations,
        joined_participant_count=member_count,
    )
    alert_state = await load_participation_alert_state(db, session_id, group_id)
    if insight.participation_equity is not None and insight.evidence_to is not None:
        alert_state = advance_participation_alert(
            alert_state,
            equity=insight.participation_equity,
            observed_at=insight.evidence_to,
        )
    return await upsert_group_insight(db, session_id, group_id, insight, alert_state)
