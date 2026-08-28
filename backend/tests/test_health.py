import os

import pytest
from fastapi.testclient import TestClient

from api import main as main_module
from api.config import get_settings
from api.main import app, create_app


class FakeDatabase:
    def __init__(self, *, ping_error: Exception | None = None) -> None:
        self.ping_error = ping_error
        self.ping_count = 0
        self.dispose_count = 0

    async def ping(self) -> None:
        self.ping_count += 1
        if self.ping_error is not None:
            raise self.ping_error

    async def dispose(self) -> None:
        self.dispose_count += 1


def test_root() -> None:
    with TestClient(app) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"service": "grouptalk-api", "docs": "/docs"}


def test_live_health() -> None:
    with TestClient(app) as client:
        response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": None}


def test_ready_health_without_database_in_local_environment(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("DATABASE_URL", "")
    get_settings.cache_clear()
    local_app = create_app()

    try:
        with TestClient(local_app) as client:
            response = client.get("/health/ready")
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "not_configured"}


def test_ready_health_requires_database_outside_local_environment(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "")
    get_settings.cache_clear()
    production_app = create_app()

    try:
        with TestClient(production_app) as client:
            response = client.get("/health/ready")
    finally:
        get_settings.cache_clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "Database is not configured"}


def test_ready_health_pings_configured_database(monkeypatch) -> None:
    database = FakeDatabase()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://unused")
    monkeypatch.setattr(main_module, "Database", lambda _url: database)
    get_settings.cache_clear()
    production_app = create_app()

    try:
        with TestClient(production_app) as client:
            response = client.get("/health/ready")
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "connected"}
    assert database.ping_count == 1
    assert database.dispose_count == 1


def test_ready_health_rejects_unreachable_database(monkeypatch) -> None:
    database = FakeDatabase(ping_error=ConnectionError("database unavailable"))
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://unused")
    monkeypatch.setattr(main_module, "Database", lambda _url: database)
    get_settings.cache_clear()
    production_app = create_app()

    try:
        with TestClient(production_app) as client:
            response = client.get("/health/ready")
    finally:
        get_settings.cache_clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "Database is unavailable"}
    assert database.ping_count == 1
    assert database.dispose_count == 1


@pytest.mark.asyncio
async def test_database_ping_executes_against_postgresql() -> None:
    database_url = os.getenv("TEST_DATABASE_URL", "").strip()
    required = os.getenv("REQUIRE_POSTGRES_TESTS", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    if not database_url:
        if required:
            pytest.fail("TEST_DATABASE_URL is required for PostgreSQL readiness tests")
        pytest.skip("TEST_DATABASE_URL is not configured")
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    database = main_module.Database(database_url)
    try:
        try:
            await database.ping()
        except Exception:
            pytest.fail("could not ping the dedicated PostgreSQL test database")
    finally:
        await database.dispose()
