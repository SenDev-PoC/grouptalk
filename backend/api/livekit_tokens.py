from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from livekit import api as livekit_api
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db_session

router = APIRouter(prefix="/livekit", tags=["livekit"])

SESSION_GROUP_QUERY = text(
    """
    select sessions.status, groups.name, device_sessions.id as device_session_id
    from sessions
    join groups on groups.session_id = sessions.id
    join device_sessions
      on device_sessions.session_id = sessions.id
     and device_sessions.group_id = groups.id
    join session_participants
      on session_participants.session_id = sessions.id
     and session_participants.group_id = groups.id
     and session_participants.device_session_id = device_sessions.id
    where sessions.id = :session_id
      and groups.id = :group_id
      and device_sessions.auth_user_id = :auth_user_id
      and session_participants.auth_user_id = :auth_user_id
      and device_sessions.client_device_key = :client_device_key
      and device_sessions.readiness_state = 'ready'
      and device_sessions.ended_at is null
      and session_participants.ended_at is null
    """
)


class LiveKitTokenRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    session_id: UUID = Field(alias="sessionId")
    group_id: UUID = Field(alias="groupId")
    group_name: str = Field(alias="groupName", min_length=1, max_length=120)
    client_device_key: str = Field(alias="clientDeviceKey", min_length=32, max_length=256)


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
    worker_agent_name: str


@dataclass(frozen=True)
class StudentIdentity:
    user_id: UUID


def get_livekit_config(request: Request) -> LiveKitConfig:
    settings = request.app.state.settings
    if (
        not settings.livekit_url
        or not settings.livekit_api_key
        or not settings.livekit_api_secret
        or not settings.livekit_worker_agent_name.strip()
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit is not configured",
        )

    return LiveKitConfig(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
        worker_agent_name=settings.livekit_worker_agent_name.strip(),
    )


def _unauthorized(detail: str = "Student authentication required") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_supabase_access_token(
    *,
    supabase_url: str,
    anon_key: str,
    access_token: str,
    timeout_seconds: float,
) -> StudentIdentity:
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.get(
                f"{supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": anon_key, "Authorization": f"Bearer {access_token}"},
            )
    except (httpx.TimeoutException, httpx.NetworkError) as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Student authentication service is unavailable",
        ) from error

    if response.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
        raise _unauthorized("Invalid or expired student access token")
    if response.is_error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Student authentication service is unavailable",
        )

    try:
        payload = response.json()
        user_id = UUID(str(payload["id"]))
    except (KeyError, TypeError, ValueError) as error:
        raise _unauthorized("Invalid student identity") from error

    if payload.get("is_anonymous") is not True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Anonymous student account required",
        )
    return StudentIdentity(user_id=user_id)


async def get_student_identity(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> StudentIdentity:
    if not authorization or not authorization.startswith("Bearer "):
        raise _unauthorized()
    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
        raise _unauthorized()

    settings = request.app.state.settings
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Student authentication is not configured",
        )

    return await verify_supabase_access_token(
        supabase_url=settings.supabase_url,
        anon_key=settings.supabase_anon_key,
        access_token=access_token,
        timeout_seconds=settings.supabase_auth_timeout_seconds,
    )


def mint_livekit_token(
    *,
    api_key: str,
    api_secret: str,
    identity: str,
    participant_name: str,
    room_name: str,
    worker_agent_name: str,
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
        .with_room_config(
            livekit_api.RoomConfiguration(
                agents=[livekit_api.RoomAgentDispatch(agent_name=worker_agent_name)]
            )
        )
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
    student: Annotated[StudentIdentity, Depends(get_student_identity)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> LiveKitTokenResponse:
    result = await db.execute(
        SESSION_GROUP_QUERY,
        {
            "session_id": payload.session_id,
            "group_id": payload.group_id,
            "auth_user_id": student.user_id,
            "client_device_key": payload.client_device_key,
        },
    )
    session_group = result.mappings().one_or_none()

    if session_group is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Participant device is not authorized",
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
        worker_agent_name=config.worker_agent_name,
    )
    return LiveKitTokenResponse(url=config.url, token=token, room_name=room_name)
