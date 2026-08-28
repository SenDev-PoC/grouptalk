import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .models import AnalysisUtterance, AnalysisWindow, ConversationAnalysisResult


@dataclass(frozen=True, slots=True)
class AnalysisCandidate:
    session_id: UUID
    group_id: UUID
    topic: str
    last_attempted_utterance_id: UUID | None
    analysis_status: str = "idle"
    retry_count: int = 0
    retry_due: bool = False


LIST_CANDIDATES_QUERY = text(
    """
    select sessions.id as session_id, groups.id as group_id, sessions.title as topic,
           group_insights.analysis_source_utterance_id as last_attempted_utterance_id,
           group_insights.analysis_status,
           group_insights.analysis_retry_count as retry_count,
           coalesce(group_insights.analysis_retry_after <= now(), false) as retry_due
    from sessions
    join groups on groups.session_id = sessions.id
    join group_insights on group_insights.session_id = sessions.id
                       and group_insights.group_id = groups.id
    where sessions.status = 'active'
      and exists (
        select 1 from utterances
        where utterances.session_id = sessions.id
          and utterances.group_id = groups.id
          and utterances.data_source = 'live'
          and utterances.speaker_label is not null
      )
    order by groups.id
    """
)

LOAD_WINDOW_QUERY = text(
    """
    with latest as (
      select max(spoken_at) as spoken_at
      from utterances
      where session_id = :session_id
        and group_id = :group_id
        and data_source = 'live'
        and speaker_label is not null
    )
    select utterances.id, utterances.speaker_label, utterances.text,
           utterances.spoken_at, utterances.created_at
    from utterances
    cross join latest
    where utterances.session_id = :session_id
      and utterances.group_id = :group_id
      and utterances.data_source = 'live'
      and utterances.speaker_label is not null
      and utterances.spoken_at >= latest.spoken_at - interval '120 seconds'
      and utterances.spoken_at <= latest.spoken_at
    order by utterances.spoken_at, utterances.created_at, utterances.id
    """
)

MARK_INSUFFICIENT_QUERY = text(
    """
    update group_insights
    set analysis_status = 'insufficient',
        analysis_source_utterance_id = :source_utterance_id,
        analysis_attempted_at = now(),
        analysis_retry_count = 0,
        analysis_retry_after = null,
        analysis_last_error_code = null
    where session_id = :session_id and group_id = :group_id
    """
)

MARK_FAILED_QUERY = text(
    """
    update group_insights
    set analysis_status = 'failed',
        analysis_source_utterance_id = :source_utterance_id,
        analysis_attempted_at = now(),
        analysis_retry_count = :retry_count,
        analysis_retry_after = case
          when cast(:retry_delay_seconds as double precision) is null then null
          else now() + make_interval(
            secs => cast(:retry_delay_seconds as double precision)
          )
        end,
        analysis_last_error_code = :error_code
    where session_id = :session_id and group_id = :group_id
    """
)

COMPLETE_ANALYSIS_QUERY = text(
    """
    update group_insights
    set topic_relevance = :topic_relevance,
        off_topic_ratio = :off_topic_ratio,
        off_topic_evidence = cast(:off_topic_evidence as jsonb),
        summary = :summary,
        keywords = :keywords,
        analysis_status = 'completed',
        analysis_confidence = :analysis_confidence,
        analysis_source_utterance_id = :source_utterance_id,
        analysis_attempted_at = now(),
        analysis_retry_count = 0,
        analysis_retry_after = null,
        analysis_last_error_code = null
    where session_id = :session_id and group_id = :group_id
    """
)


class ConversationAnalysisRepository:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def list_candidates(self) -> tuple[AnalysisCandidate, ...]:
        async with self._session_factory() as session:
            result = await session.execute(LIST_CANDIDATES_QUERY)
            return tuple(AnalysisCandidate(**row) for row in result.mappings().all())

    async def load_window(self, candidate: AnalysisCandidate) -> AnalysisWindow | None:
        async with self._session_factory() as session:
            result = await session.execute(
                LOAD_WINDOW_QUERY,
                {"session_id": candidate.session_id, "group_id": candidate.group_id},
            )
            rows = result.mappings().all()
        if not rows:
            return None
        return AnalysisWindow(
            session_id=candidate.session_id,
            group_id=candidate.group_id,
            topic=candidate.topic,
            utterances=tuple(
                AnalysisUtterance(
                    id=row["id"],
                    speaker_label=row["speaker_label"],
                    text=row["text"],
                    spoken_at=row["spoken_at"],
                )
                for row in rows
            ),
        )

    async def mark_insufficient(self, window: AnalysisWindow) -> None:
        await self._update(
            MARK_INSUFFICIENT_QUERY,
            window=window,
        )

    async def mark_failed(
        self,
        window: AnalysisWindow,
        *,
        error_code: str,
        retry_count: int,
        retry_delay_seconds: int | None,
    ) -> None:
        await self._update(
            MARK_FAILED_QUERY,
            window=window,
            extra={
                "error_code": error_code,
                "retry_count": retry_count,
                "retry_delay_seconds": retry_delay_seconds,
            },
        )

    async def complete(
        self,
        window: AnalysisWindow,
        result: ConversationAnalysisResult,
    ) -> None:
        utterances_by_id = {item.id: item for item in window.utterances}
        evidence = [
            {
                "quote": utterances_by_id[utterance_id].text,
                "reason": result.off_topic_reason,
                "at": _isoformat(utterances_by_id[utterance_id].spoken_at),
            }
            for utterance_id in result.off_topic_utterance_ids
        ]
        off_topic_ratio = len(result.off_topic_utterance_ids) / len(window.utterances)
        await self._update(
            COMPLETE_ANALYSIS_QUERY,
            window=window,
            extra={
                "topic_relevance": result.topic_relevance,
                "off_topic_ratio": off_topic_ratio,
                "off_topic_evidence": json.dumps(evidence, ensure_ascii=False),
                "summary": result.summary,
                "keywords": result.keywords,
                "analysis_confidence": result.confidence,
            },
        )

    async def _update(
        self,
        statement: object,
        *,
        window: AnalysisWindow,
        extra: dict[str, object] | None = None,
    ) -> None:
        parameters: dict[str, object] = {
            "session_id": window.session_id,
            "group_id": window.group_id,
            "source_utterance_id": window.latest_utterance_id,
        }
        parameters.update(extra or {})
        async with self._session_factory() as session, session.begin():
            await session.execute(statement, parameters)


def _isoformat(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")
