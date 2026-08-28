from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from .policy import build_participation_insight
from .repository import load_analysis_window, upsert_group_insight


async def project_realtime_participation(
    db: AsyncSession,
    session_id: UUID,
    group_id: UUID,
) -> bool:
    observations = await load_analysis_window(db, session_id, group_id)
    insight = build_participation_insight(observations)
    return await upsert_group_insight(db, session_id, group_id, insight)
