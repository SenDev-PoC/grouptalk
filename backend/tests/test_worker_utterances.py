import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType
from uuid import UUID, uuid4

import asyncpg
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import get_settings
from api.database import get_db_session
from api.main import create_app

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
GROUP_ID = UUID("22222222-2222-4222-8222-222222222222")
UTTERANCE_ID = UUID("33333333-3333-4333-8333-333333333333")
WORKER_TOKEN = "worker-test-token-with-at-least-32-characters"
SPOKEN_AT = datetime(2026, 8, 29, 1, 2, 3, tzinfo=UTC)
LIVE_UTTERANCES_MIGRATION = (
    Path(__file__).resolve().parents[2] / "supabase/migrations/20260829000000_live_utterances.sql"
)


class FakeMappings:
    def __init__(self, row: dict[str, object] | None) -> None:
        self.row = row

    def one_or_none(self) -> dict[str, object] | None:
        return self.row


class FakeResult:
    def __init__(self, row: dict[str, object] | None) -> None:
        self.row = row

    def mappings(self) -> FakeMappings:
        return FakeMappings(self.row)


class FakeTransaction:
    def __init__(self, session: "FakeSession") -> None:
        self.session = session

    async def __aenter__(self) -> None:
        self.session.transaction_started = True

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.session.rolled_back = exc_type is not None
        self.session.committed = exc_type is None


class FakeSession:
    def __init__(
        self,
        *,
        session_group: dict[str, object] | None = None,
        inserted: dict[str, object] | None = None,
        existing: dict[str, object] | None = None,
        insert_error: Exception | None = None,
    ) -> None:
        self.session_group = session_group
        self.inserted = inserted
        self.existing = existing
        self.insert_error = insert_error
        self.statements: list[str] = []
        self.parameters: list[dict[str, object]] = []
        self.transaction_started = False
        self.committed = False
        self.rolled_back = False

    def begin(self) -> FakeTransaction:
        return FakeTransaction(self)

    async def execute(self, statement, parameters) -> FakeResult:
        sql = str(statement)
        self.statements.append(sql)
        self.parameters.append(parameters)

        if "from sessions" in sql:
            return FakeResult(self.session_group)
        if "insert into utterances" in sql:
            if self.insert_error is not None:
                raise self.insert_error
            return FakeResult(self.inserted)
        if "from utterances" in sql:
            return FakeResult(self.existing)
        raise AssertionError(f"unexpected SQL: {sql}")


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "source_event_id": "event-1",
        "session_id": str(SESSION_ID),
        "group_id": str(GROUP_ID),
        "speaker_label": "화자 A",
        "text": "첫 번째 의견입니다.",
        "spoken_at": SPOKEN_AT.isoformat(),
    }
    payload.update(overrides)
    return payload


def _configured_app(monkeypatch, session: FakeSession, *, token: str = WORKER_TOKEN):
    monkeypatch.setenv("WORKER_API_TOKEN", token)
    get_settings.cache_clear()
    application = create_app()

    async def override_db_session() -> AsyncIterator[FakeSession]:
        yield session

    application.dependency_overrides[get_db_session] = override_db_session
    return application


def _post(client: TestClient, payload: dict[str, object] | None = None, token: str = WORKER_TOKEN):
    return client.post(
        "/internal/worker/utterances",
        json=payload or _payload(),
        headers={"Authorization": f"Bearer {token}"},
    )


def test_worker_endpoint_requires_server_configuration(monkeypatch) -> None:
    session = FakeSession()
    application = _configured_app(monkeypatch, session, token="")

    try:
        with TestClient(application) as client:
            response = _post(client)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 503
    assert response.json() == {"detail": {"code": "worker_api_not_configured"}}
    assert session.statements == []


@pytest.mark.parametrize("authorization", [None, "Basic abc", "Bearer wrong-token"])
def test_worker_endpoint_rejects_missing_or_invalid_bearer(monkeypatch, authorization) -> None:
    session = FakeSession()
    application = _configured_app(monkeypatch, session)
    headers = {} if authorization is None else {"Authorization": authorization}

    try:
        with TestClient(application) as client:
            response = client.post("/internal/worker/utterances", json=_payload(), headers=headers)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 401
    assert response.json() == {"detail": {"code": "worker_unauthorized"}}
    assert session.statements == []


def test_worker_endpoint_rejects_unknown_session_group(monkeypatch) -> None:
    session = FakeSession(session_group=None)
    application = _configured_app(monkeypatch, session)

    try:
        with TestClient(application) as client:
            response = _post(client)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 404
    assert response.json() == {"detail": {"code": "session_group_not_found"}}
    assert session.rolled_back is True


def test_worker_endpoint_rejects_inactive_session(monkeypatch) -> None:
    session = FakeSession(session_group={"status": "ended"})
    application = _configured_app(monkeypatch, session)

    try:
        with TestClient(application) as client:
            response = _post(client)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 409
    assert response.json() == {"detail": {"code": "session_not_active"}}
    assert session.rolled_back is True


def test_worker_endpoint_stores_first_delivery(monkeypatch) -> None:
    session = FakeSession(
        session_group={"status": "active"},
        inserted={"id": UTTERANCE_ID},
    )
    application = _configured_app(monkeypatch, session)

    try:
        with TestClient(application) as client:
            response = _post(client)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 201
    assert response.json() == {"status": "stored", "utterance_id": str(UTTERANCE_ID)}
    assert session.committed is True
    assert all("group_insights" not in statement for statement in session.statements)
    insert_parameters = session.parameters[1]
    assert insert_parameters["source_event_id"] == "event-1"
    assert insert_parameters["spoken_at"] == SPOKEN_AT


def test_worker_endpoint_returns_existing_id_for_exact_retry(monkeypatch) -> None:
    existing = {
        "id": UTTERANCE_ID,
        "speaker_label": "화자 A",
        "text": "첫 번째 의견입니다.",
        "spoken_at": SPOKEN_AT,
    }
    session = FakeSession(session_group={"status": "active"}, inserted=None, existing=existing)
    application = _configured_app(monkeypatch, session)

    try:
        with TestClient(application) as client:
            response = _post(client)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200
    assert response.json() == {"status": "duplicate", "utterance_id": str(UTTERANCE_ID)}
    assert session.committed is True


def test_worker_endpoint_rejects_same_event_id_with_different_payload(monkeypatch) -> None:
    existing = {
        "id": UTTERANCE_ID,
        "speaker_label": "화자 B",
        "text": "다른 내용",
        "spoken_at": SPOKEN_AT,
    }
    session = FakeSession(session_group={"status": "active"}, inserted=None, existing=existing)
    application = _configured_app(monkeypatch, session)

    try:
        with TestClient(application) as client:
            response = _post(client)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 409
    assert response.json() == {"detail": {"code": "source_event_conflict"}}
    assert session.rolled_back is True


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("source_event_id", ""),
        ("speaker_label", "학생 1"),
        ("text", " "),
        ("spoken_at", "2026-08-29T01:02:03"),
    ],
)
def test_worker_endpoint_validates_payload(monkeypatch, field: str, value: object) -> None:
    session = FakeSession()
    application = _configured_app(monkeypatch, session)

    try:
        with TestClient(application) as client:
            response = _post(client, _payload(**{field: value}))
    finally:
        get_settings.cache_clear()

    assert response.status_code == 422
    assert session.statements == []


def test_worker_endpoint_rolls_back_transaction_errors(monkeypatch) -> None:
    session = FakeSession(
        session_group={"status": "active"},
        insert_error=RuntimeError("database failed"),
    )
    application = _configured_app(monkeypatch, session)

    try:
        with TestClient(application, raise_server_exceptions=False) as client:
            response = _post(client)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 500
    assert session.rolled_back is True
    assert all("group_insights" not in statement for statement in session.statements)


def _postgres_test_url() -> str:
    database_url = os.getenv("TEST_DATABASE_URL", "").strip()
    required = os.getenv("REQUIRE_POSTGRES_TESTS", "").strip().lower() in {"1", "true", "yes"}
    if not database_url:
        if required:
            pytest.fail("TEST_DATABASE_URL is required for PostgreSQL endpoint tests")
        pytest.skip("TEST_DATABASE_URL is not configured")
    return database_url


def _asyncpg_url(database_url: str) -> str:
    return database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _sqlalchemy_url(database_url: str) -> str:
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url
    return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)


@pytest.mark.asyncio
async def test_worker_endpoint_executes_idempotency_contract_on_postgresql(monkeypatch) -> None:
    database_url = _postgres_test_url()
    schema_name = f"worker_api_test_{uuid4().hex}"
    quoted_schema = f'"{schema_name}"'
    setup_connection = None
    engine = None

    try:
        try:
            setup_connection = await asyncpg.connect(_asyncpg_url(database_url))
        except Exception:
            pytest.fail("could not connect to the dedicated PostgreSQL test database")
        await setup_connection.execute(f"create schema {quoted_schema}")
        await setup_connection.execute("select set_config('search_path', $1, false)", schema_name)
        await setup_connection.execute(
            """
            create table sessions (id uuid primary key, status text not null);
            create table groups (id uuid primary key, session_id uuid not null);
            create table utterances (
              id uuid primary key default gen_random_uuid(),
              session_id uuid not null,
              group_id uuid not null,
              speaker_label text not null,
              text text not null,
              data_source text not null default 'synthetic' check (data_source = 'synthetic'),
              spoken_at timestamptz not null default now(),
              created_at timestamptz not null default now()
            );
            """
        )
        await setup_connection.execute(
            "insert into sessions (id, status) values ($1, 'active')",
            SESSION_ID,
        )
        await setup_connection.execute(
            "insert into groups (id, session_id) values ($1, $2)",
            GROUP_ID,
            SESSION_ID,
        )
        await setup_connection.execute(LIVE_UTTERANCES_MIGRATION.read_text(encoding="utf-8"))

        engine = create_async_engine(
            _sqlalchemy_url(database_url),
            connect_args={"server_settings": {"search_path": schema_name}},
        )
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        monkeypatch.setenv("WORKER_API_TOKEN", WORKER_TOKEN)
        monkeypatch.setenv("DATABASE_URL", "")
        get_settings.cache_clear()
        application = create_app()

        async def override_db_session() -> AsyncIterator[AsyncSession]:
            async with session_factory() as session:
                yield session

        application.dependency_overrides[get_db_session] = override_db_session
        transport = httpx.ASGITransport(app=application)
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                headers = {"Authorization": f"Bearer {WORKER_TOKEN}"}
                first = await client.post(
                    "/internal/worker/utterances", json=_payload(), headers=headers
                )
                duplicate = await client.post(
                    "/internal/worker/utterances", json=_payload(), headers=headers
                )
                conflict = await client.post(
                    "/internal/worker/utterances",
                    json=_payload(text="같은 ID의 다른 내용"),
                    headers=headers,
                )

        stored_count = await setup_connection.fetchval("select count(*) from utterances")
        assert first.status_code == 201
        assert duplicate.status_code == 200
        assert duplicate.json()["utterance_id"] == first.json()["utterance_id"]
        assert conflict.status_code == 409
        assert conflict.json() == {"detail": {"code": "source_event_conflict"}}
        assert stored_count == 1
    finally:
        get_settings.cache_clear()
        if engine is not None:
            await engine.dispose()
        if setup_connection is not None:
            try:
                await setup_connection.execute("select set_config('search_path', 'public', false)")
                await setup_connection.execute(f"drop schema if exists {quoted_schema} cascade")
            finally:
                await setup_connection.close()
