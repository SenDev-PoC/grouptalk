import os
import re
from pathlib import Path

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "supabase" / "schema.sql"
MIGRATION_PATH = (
    ROOT / "supabase" / "migrations" / "20260829210000_secure_group_presence.sql"
)


def _normalized_sql(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8")).strip().lower()


def test_presence_migration_replaces_unsafe_rpc() -> None:
    assert MIGRATION_PATH.exists()
    sql = _normalized_sql(MIGRATION_PATH)

    assert "revoke all on function public.report_group_presence(uuid, text)" in sql
    assert "drop function if exists public.report_group_presence(uuid, text)" in sql
    assert (
        "create or replace function public.report_group_presence( requested_group_id uuid, "
        "requested_client_device_key text, requested_connection_state text"
    ) in sql
    assert "security definer" in sql
    assert "set search_path = pg_catalog, public" in sql
    assert "auth.uid()" in sql
    assert "auth.jwt()" in sql
    assert "ds.client_device_key = requested_client_device_key" in sql
    assert "ds.group_id = requested_group_id" in sql
    assert "ds.ended_at is null" in sql
    assert "sp.ended_at is null" in sql
    assert (
        "grant execute on function public.report_group_presence(uuid, text, text) "
        "to authenticated"
    ) in sql


def test_canonical_schema_only_exposes_bound_presence_rpc() -> None:
    schema = _normalized_sql(SCHEMA_PATH)
    assert (
        "report_group_presence( requested_group_id uuid, requested_connection_state text"
        not in schema
    )
    assert "requested_client_device_key text" in schema
    assert "drop function if exists public.report_group_presence(uuid, text)" not in schema


def _postgres_required() -> bool:
    return os.getenv("REQUIRE_POSTGRES_TESTS", "").strip().lower() in {"1", "true", "yes"}


@pytest.mark.asyncio
async def test_old_presence_signature_is_removed() -> None:
    database_url = os.getenv("TEST_DATABASE_URL", "").strip()
    if not database_url:
        if _postgres_required():
            pytest.fail("TEST_DATABASE_URL is required for PostgreSQL security tests")
        pytest.skip("TEST_DATABASE_URL is not configured")

    connection = await asyncpg.connect(
        database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    )
    try:
        assert await connection.fetchval(
            "select to_regprocedure('public.report_group_presence(uuid,text)')"
        ) is None
        assert await connection.fetchval(
            "select to_regprocedure('public.report_group_presence(uuid,text,text)')"
        ) == "report_group_presence(uuid,text,text)"
    finally:
        await connection.close()
