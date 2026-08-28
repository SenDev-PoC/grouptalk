from uuid import UUID

from fastapi.testclient import TestClient
from livekit import api as livekit_api

from api import livekit_tokens
from api.config import get_settings
from api.database import get_db_session
from api.main import create_app

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
GROUP_ID = UUID("22222222-2222-4222-8222-222222222222")
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

    async def execute(self, statement, parameters) -> FakeResult:
        return FakeResult(self.row)


def create_configured_app(monkeypatch, row: dict[str, str] | None):
    monkeypatch.setenv("LIVEKIT_URL", "wss://example.livekit.cloud")
    monkeypatch.setenv("LIVEKIT_API_KEY", "test-key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", TEST_API_SECRET)
    monkeypatch.setenv("LIVEKIT_WORKER_AGENT_NAME", "grouptalk-transcriber")
    get_settings.cache_clear()
    application = create_app()

    async def override_db_session():
        yield FakeSession(row)

    application.dependency_overrides[get_db_session] = override_db_session
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
                },
            )
    finally:
        get_settings.cache_clear()

    assert response.status_code == 404
    assert response.json() == {"detail": "Session group not found"}


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
