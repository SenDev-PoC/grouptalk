from fastapi.testclient import TestClient

from api.config import get_settings
from api.main import app, create_app


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
