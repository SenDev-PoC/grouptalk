import os
import re
from pathlib import Path

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "supabase" / "schema.sql"
MIGRATION_PATH = ROOT / "supabase" / "migrations" / "20260829200000_auth_participant_boundary.sql"


def _normalized_sql(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8")).strip().lower()


def test_participant_migration_has_fail_closed_join_contract() -> None:
    assert MIGRATION_PATH.exists()
    sql = _normalized_sql(MIGRATION_PATH)

    assert "add column if not exists auth_user_id uuid" in sql
    assert "create table if not exists public.session_participants" in sql
    assert "auth_user_id uuid not null" in sql
    assert "references auth.users (id)" in sql
    assert "create or replace function public.join_session_group" in sql
    assert "security definer" in sql
    assert "set search_path = pg_catalog, public" in sql
    assert "auth.uid()" in sql
    assert "auth.jwt()" in sql
    assert "is_anonymous" in sql
    assert "extensions.gen_random_bytes(32)" in sql
    assert "grant execute on function public.join_session_group" in sql
    assert "to authenticated" in sql
    assert "to anon" not in sql[sql.index("grant execute on function public.join_session_group") :]


def test_canonical_schema_contains_participant_boundary() -> None:
    schema = _normalized_sql(SCHEMA_PATH)
    assert "create table if not exists session_participants" in schema
    assert "auth_user_id uuid" in schema
    assert "create or replace function public.join_session_group" in schema


def _postgres_required() -> bool:
    return os.getenv("REQUIRE_POSTGRES_TESTS", "").strip().lower() in {"1", "true", "yes"}


async def _connect_to_test_database() -> asyncpg.Connection:
    database_url = os.getenv("TEST_DATABASE_URL", "").strip()
    if not database_url:
        if _postgres_required():
            pytest.fail("TEST_DATABASE_URL is required for PostgreSQL security tests")
        pytest.skip("TEST_DATABASE_URL is not configured")
    return await asyncpg.connect(database_url.replace("postgresql+asyncpg://", "postgresql://", 1))


@pytest.mark.asyncio
async def test_participant_tables_are_not_directly_exposed_to_browser_roles() -> None:
    connection = await _connect_to_test_database()
    try:
        for role in ("anon", "authenticated"):
            for statement in (
                "select * from public.session_participants limit 1",
                "select auth_user_id from public.device_sessions limit 1",
            ):
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    async with connection.transaction():
                        await connection.execute(f"set local role {role}")
                        await connection.fetch(statement)
    finally:
        await connection.close()
