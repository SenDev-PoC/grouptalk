from uuid import UUID

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from livekit import api as livekit_api

from api import livekit_tokens
from api.config import get_settings
from api.database import get_db_session
from api.main import create_app

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
GROUP_ID = UUID("22222222-2222-4222-8222-222222222222")
AUTH_USER_ID = UUID("33333333-3333-4333-8333-333333333333")
DEVICE_KEY = "a" * 64
TEST_API_SECRET = "test-secret-with-at-least-32-bytes"


class FakeMappings:
    def __init__(self, row: dict[str, str] | None) -> None:
        self.row = row

    def one_or_none(self) -> dict[str, str] | None:
        return self.row


class FakeResult:
    def __init__(self, row: dict[str, str] | None) -> None:
        self.row = row

    def mappings(self) -> FakeMappings:
        return FakeMappings(self.row)


class FakeSession:
    def __init__(self, row: dict[str, str] | None) -> None:
        self.row = row
        self.parameters = None

    async def execute(self, statement, parameters) -> FakeResult:
        self.parameters = parameters
        return FakeResult(self.row)


def create_configured_app(
    monkeypatch, row: dict[str, str] | None, *, authenticated: bool = True
):
    monkeypatch.setenv("LIVEKIT_URL", "wss://example.livekit.cloud")
    monkeypatch.setenv("LIVEKIT_API_KEY", "test-key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", TEST_API_SECRET)
    monkeypatch.setenv("LIVEKIT_WORKER_AGENT_NAME", "grouptalk-transcriber")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "test-anon-key")
    get_settings.cache_clear()
    application = create_app()

    async def override_db_session():
        yield FakeSession(row)

    application.dependency_overrides[get_db_session] = override_db_session
    if authenticated:
        application.dependency_overrides[livekit_tokens.get_student_identity] = (
            lambda: livekit_tokens.StudentIdentity(user_id=AUTH_USER_ID)
        )
    return application


def test_livekit_token_requires_configuration(monkeypatch) -> None:
    # Empty process variables override values from a developer's local .env.
    monkeypatch.setenv("LIVEKIT_URL", "")
    monkeypatch.setenv("LIVEKIT_API_KEY", "")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "")
    get_settings.cache_clear()
    application = create_app()

    async def override_db_session():
        yield FakeSession(None)

    application.dependency_overrides[get_db_session] = override_db_session

    try:
        with TestClient(application) as client:
            response = client.post(
                "/livekit/token",
                json={
                    "sessionId": str(SESSION_ID),
                    "groupId": str(GROUP_ID),
                    "groupName": "3모둠",
                    "clientDeviceKey": DEVICE_KEY,
                },
            )
    finally:
        get_settings.cache_clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "LiveKit is not configured"}


def test_livekit_token_rejects_unknown_session_group(monkeypatch) -> None:
    application = create_configured_app(monkeypatch, None)

    try:
        with TestClient(application) as client:
            response = client.post(
                "/livekit/token",
                json={
                    "sessionId": str(SESSION_ID),
                    "groupId": str(GROUP_ID),
                    "groupName": "3모둠",
                    "clientDeviceKey": DEVICE_KEY,
                },
            )
    finally:
        get_settings.cache_clear()

    assert response.status_code == 403
    assert response.json() == {"detail": "Participant device is not authorized"}


def test_livekit_token_rejects_inactive_session(monkeypatch) -> None:
    application = create_configured_app(monkeypatch, {"status": "waiting", "name": "3모둠"})

    try:
        with TestClient(application) as client:
            response = client.post(
                "/livekit/token",
                json={
                    "sessionId": str(SESSION_ID),
                    "groupId": str(GROUP_ID),
                    "groupName": "3모둠",
                    "clientDeviceKey": DEVICE_KEY,
                },
            )
    finally:
        get_settings.cache_clear()

    assert response.status_code == 409
    assert response.json() == {"detail": "Session is not active"}


def test_livekit_token_uses_database_group_name_and_minimal_room_grant(monkeypatch) -> None:
    application = create_configured_app(monkeypatch, {"status": "active", "name": "3모둠"})
    minted_with: dict[str, str] = {}

    def fake_mint_livekit_token(**kwargs: str) -> str:
        minted_with.update(kwargs)
        return "signed-token"

    monkeypatch.setattr(livekit_tokens, "mint_livekit_token", fake_mint_livekit_token)

    try:
        with TestClient(application) as client:
            response = client.post(
                "/livekit/token",
                json={
                    "sessionId": str(SESSION_ID),
                    "groupId": str(GROUP_ID),
                    "groupName": "위조된 이름",
                    "clientDeviceKey": DEVICE_KEY,
                },
            )
    finally:
        get_settings.cache_clear()

    room_name = f"session_{SESSION_ID}"
    assert response.status_code == 200
    assert response.json() == {
        "url": "wss://example.livekit.cloud",
        "token": "signed-token",
        "roomName": room_name,
    }
    assert minted_with == {
        "api_key": "test-key",
        "api_secret": TEST_API_SECRET,
        "identity": str(GROUP_ID),
        "participant_name": "3모둠",
        "room_name": room_name,
        "worker_agent_name": "grouptalk-transcriber",
    }


def test_livekit_token_requires_bearer_student_auth(monkeypatch) -> None:
    application = create_configured_app(
        monkeypatch,
        {"status": "active", "name": "3모둠"},
        authenticated=False,
    )

    try:
        with TestClient(application) as client:
            response = client.post(
                "/livekit/token",
                json={
                    "sessionId": str(SESSION_ID),
                    "groupId": str(GROUP_ID),
                    "groupName": "3모둠",
                    "clientDeviceKey": DEVICE_KEY,
                },
            )
    finally:
        get_settings.cache_clear()

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_livekit_query_binds_auth_user_and_device_key(monkeypatch) -> None:
    fake_session = FakeSession({"status": "active", "name": "3모둠"})
    application = create_configured_app(monkeypatch, None)

    async def override_db_session():
        yield fake_session

    application.dependency_overrides[get_db_session] = override_db_session
    monkeypatch.setattr(livekit_tokens, "mint_livekit_token", lambda **_kwargs: "signed-token")

    try:
        with TestClient(application) as client:
            response = client.post(
                "/livekit/token",
                headers={"Authorization": "Bearer student-token"},
                json={
                    "sessionId": str(SESSION_ID),
                    "groupId": str(GROUP_ID),
                    "groupName": "3모둠",
                    "clientDeviceKey": DEVICE_KEY,
                },
            )
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200
    assert fake_session.parameters == {
        "session_id": SESSION_ID,
        "group_id": GROUP_ID,
        "auth_user_id": AUTH_USER_ID,
        "client_device_key": DEVICE_KEY,
    }


class FakeAuthClient:
    def __init__(self, response: httpx.Response) -> None:
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, *_args, **_kwargs) -> httpx.Response:
        return self.response


@pytest.mark.asyncio
async def test_supabase_verifier_accepts_only_anonymous_user(monkeypatch) -> None:
    request = httpx.Request("GET", "https://example.supabase.co/auth/v1/user")
    response = httpx.Response(
        200,
        request=request,
        json={"id": str(AUTH_USER_ID), "is_anonymous": True},
    )
    monkeypatch.setattr(
        livekit_tokens.httpx,
        "AsyncClient",
        lambda **_kwargs: FakeAuthClient(response),
    )

    identity = await livekit_tokens.verify_supabase_access_token(
        supabase_url="https://example.supabase.co",
        anon_key="anon-key",
        access_token="student-token",
        timeout_seconds=5,
    )
    assert identity.user_id == AUTH_USER_ID

    response = httpx.Response(
        200,
        request=request,
        json={"id": str(AUTH_USER_ID), "is_anonymous": False},
    )
    with pytest.raises(HTTPException) as forbidden:
        await livekit_tokens.verify_supabase_access_token(
            supabase_url="https://example.supabase.co",
            anon_key="anon-key",
            access_token="teacher-token",
            timeout_seconds=5,
        )
    assert forbidden.value.status_code == 403


@pytest.mark.asyncio
async def test_supabase_verifier_rejects_invalid_token(monkeypatch) -> None:
    response = httpx.Response(
        401,
        request=httpx.Request("GET", "https://example.supabase.co/auth/v1/user"),
    )
    monkeypatch.setattr(
        livekit_tokens.httpx,
        "AsyncClient",
        lambda **_kwargs: FakeAuthClient(response),
    )

    with pytest.raises(HTTPException) as unauthorized:
        await livekit_tokens.verify_supabase_access_token(
            supabase_url="https://example.supabase.co",
            anon_key="anon-key",
            access_token="invalid-token",
            timeout_seconds=5,
        )
    assert unauthorized.value.status_code == 401


def test_minted_token_is_signed_and_restricted_to_microphone_publish() -> None:
    token = livekit_tokens.mint_livekit_token(
        api_key="test-key",
        api_secret=TEST_API_SECRET,
        identity=str(GROUP_ID),
        participant_name="3모둠",
        room_name=f"session_{SESSION_ID}",
        worker_agent_name="grouptalk-transcriber",
    )

    claims = livekit_api.TokenVerifier("test-key", TEST_API_SECRET).verify(token)

    assert claims.identity == str(GROUP_ID)
    assert claims.name == "3모둠"
    assert claims.video is not None
    assert claims.video.room_join is True
    assert claims.video.room == f"session_{SESSION_ID}"
    assert claims.video.can_publish is True
    assert claims.video.can_subscribe is False
    assert claims.video.can_publish_data is False
    assert claims.video.can_publish_sources == ["microphone"]
    assert claims.room_config is not None
    assert [agent.agent_name for agent in claims.room_config.agents] == ["grouptalk-transcriber"]
