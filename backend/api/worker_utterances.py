import secrets
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db_session
from api.realtime_analysis.service import project_realtime_participation

router = APIRouter(prefix="/internal/worker", tags=["worker"])

GROUP_ANALYSIS_LOCK_QUERY = text(
    "select pg_advisory_xact_lock(hashtextextended(:analysis_lock_key, 0))"
)

SESSION_GROUP_FOR_SHARE_QUERY = text(
    """
    select sessions.status
    from sessions
    join groups on groups.session_id = sessions.id
    where sessions.id = :session_id
      and groups.id = :group_id
    for share of sessions, groups
    """
)

INSERT_UTTERANCE_QUERY = text(
    """
    insert into utterances (
      session_id,
      group_id,
      speaker_label,
      text,
      data_source,
      source_event_id,
      spoken_at
    )
    values (
      :session_id,
      :group_id,
      :speaker_label,
      :text,
      'live',
      :source_event_id,
      :spoken_at
    )
    on conflict (session_id, group_id, source_event_id)
      where source_event_id is not null
    do nothing
    returning id
    """
)

EXISTING_UTTERANCE_QUERY = text(
    """
    select id, speaker_label, text, spoken_at
    from utterances
    where session_id = :session_id
      and group_id = :group_id
      and source_event_id = :source_event_id
    """
)


class WorkerUtteranceRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    source_event_id: str = Field(min_length=1, max_length=128)
    session_id: UUID
    group_id: UUID
    speaker_label: str = Field(min_length=4, max_length=32, pattern=r"^화자 [A-Z]+$")
    text: str = Field(min_length=1, max_length=10_000)
    spoken_at: datetime

    @field_validator("spoken_at")
    @classmethod
    def normalize_spoken_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("spoken_at must include a timezone")
        return value.astimezone(UTC)


class WorkerUtteranceResponse(BaseModel):
    status: Literal["stored", "duplicate"]
    utterance_id: UUID


class WorkerAuthorization:
    pass


def _error(status_code: int, code: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code})


def require_worker_authorization(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> WorkerAuthorization:
    configured_token = request.app.state.settings.worker_api_token
    if not configured_token or len(configured_token) < 32:
        raise _error(status.HTTP_503_SERVICE_UNAVAILABLE, "worker_api_not_configured")

    scheme, separator, provided_token = (authorization or "").partition(" ")
    valid_scheme = bool(separator) and scheme.casefold() == "bearer"
    valid_token = secrets.compare_digest(provided_token, configured_token)
    if not valid_scheme or not valid_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "worker_unauthorized"},
            headers={"WWW-Authenticate": "Bearer"},
        )

    return WorkerAuthorization()


def _same_payload(existing: dict[str, object], payload: WorkerUtteranceRequest) -> bool:
    existing_spoken_at = existing["spoken_at"]
    if not isinstance(existing_spoken_at, datetime):
        return False
    if existing_spoken_at.tzinfo is None or existing_spoken_at.utcoffset() is None:
        return False

    return (
        existing["speaker_label"] == payload.speaker_label
        and existing["text"] == payload.text
        and existing_spoken_at.astimezone(UTC) == payload.spoken_at
    )


@router.post("/utterances", response_model=WorkerUtteranceResponse)
async def create_worker_utterance(
    payload: WorkerUtteranceRequest,
    _authorization: Annotated[WorkerAuthorization, Depends(require_worker_authorization)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> JSONResponse:
    parameters = {
        "source_event_id": payload.source_event_id,
        "session_id": payload.session_id,
        "group_id": payload.group_id,
        "speaker_label": payload.speaker_label,
        "text": payload.text,
        "spoken_at": payload.spoken_at,
    }

    async with db.begin():
        await db.execute(
            GROUP_ANALYSIS_LOCK_QUERY,
            {"analysis_lock_key": f"{payload.session_id}:{payload.group_id}"},
        )
        session_group_result = await db.execute(
            SESSION_GROUP_FOR_SHARE_QUERY,
            {"session_id": payload.session_id, "group_id": payload.group_id},
        )
        session_group = session_group_result.mappings().one_or_none()
        if session_group is None:
            raise _error(status.HTTP_404_NOT_FOUND, "session_group_not_found")
        if session_group["status"] != "active":
            raise _error(status.HTTP_409_CONFLICT, "session_not_active")

        insert_result = await db.execute(INSERT_UTTERANCE_QUERY, parameters)
        inserted = insert_result.mappings().one_or_none()
        if inserted is not None:
            await project_realtime_participation(db, payload.session_id, payload.group_id)
            response = WorkerUtteranceResponse(status="stored", utterance_id=inserted["id"])
            return JSONResponse(
                status_code=status.HTTP_201_CREATED, content=response.model_dump(mode="json")
            )

        existing_result = await db.execute(EXISTING_UTTERANCE_QUERY, parameters)
        existing = existing_result.mappings().one_or_none()
        if existing is None or not _same_payload(existing, payload):
            raise _error(status.HTTP_409_CONFLICT, "source_event_conflict")

        response = WorkerUtteranceResponse(status="duplicate", utterance_id=existing["id"])
        return JSONResponse(
            status_code=status.HTTP_200_OK, content=response.model_dump(mode="json")
        )
