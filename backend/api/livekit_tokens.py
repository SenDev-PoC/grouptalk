from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from livekit import api as livekit_api
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db_session

router = APIRouter(prefix="/livekit", tags=["livekit"])

SESSION_GROUP_QUERY = text(
    """
    select sessions.status, groups.name
    from sessions
    join groups on groups.session_id = sessions.id
    where sessions.id = :session_id
      and groups.id = :group_id
    """
)


class LiveKitTokenRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    session_id: UUID = Field(alias="sessionId")
    group_id: UUID = Field(alias="groupId")
    group_name: str = Field(alias="groupName", min_length=1, max_length=120)


class LiveKitTokenResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    url: str
    token: str
    room_name: str = Field(alias="roomName")


@dataclass(frozen=True)
class LiveKitConfig:
    url: str
    api_key: str
    api_secret: str


def get_livekit_config(request: Request) -> LiveKitConfig:
    settings = request.app.state.settings
    if not settings.livekit_url or not settings.livekit_api_key or not settings.livekit_api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit is not configured",
        )

    return LiveKitConfig(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    )


def mint_livekit_token(
    *,
    api_key: str,
    api_secret: str,
    identity: str,
    participant_name: str,
    room_name: str,
) -> str:
    grants = livekit_api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=False,
        can_publish_data=False,
        can_publish_sources=["microphone"],
    )
    return (
        livekit_api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(participant_name)
        .with_grants(grants)
        .with_ttl(timedelta(minutes=10))
        .to_jwt()
    )


@router.post(
    "/token",
    response_model=LiveKitTokenResponse,
    response_model_by_alias=True,
)
async def create_livekit_token(
    payload: LiveKitTokenRequest,
    config: Annotated[LiveKitConfig, Depends(get_livekit_config)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> LiveKitTokenResponse:
    result = await db.execute(
        SESSION_GROUP_QUERY,
        {"session_id": payload.session_id, "group_id": payload.group_id},
    )
    session_group = result.mappings().one_or_none()

    if session_group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session group not found",
        )
    if session_group["status"] != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is not active",
        )

    room_name = f"session_{payload.session_id}"
    token = mint_livekit_token(
        api_key=config.api_key,
        api_secret=config.api_secret,
        identity=str(payload.group_id),
        participant_name=session_group["name"],
        room_name=room_name,
    )
    return LiveKitTokenResponse(url=config.url, token=token, room_name=room_name)
