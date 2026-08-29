import os
import re
from pathlib import Path

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "supabase" / "schema.sql"
MIGRATION_PATH = ROOT / "supabase" / "migrations" / "20260829220000_authenticated_rls.sql"


def _normalized_sql(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8")).strip().lower()


def test_final_schema_has_no_permissive_demo_policy() -> None:
    schema = _normalized_sql(SCHEMA_PATH)
    assert "create policy demo_open_" not in schema
    assert "create policy utterances_demo_read" not in schema
    assert "create policy group_insights_demo_read" not in schema
    assert "using (true)" not in schema
    assert "with check (true)" not in schema


def test_join_preview_hides_teacher_identity_and_ended_rosters() -> None:
    sql = (ROOT / "supabase" / "migrations" / "20260829230000_harden_join_preview.sql").read_text(
        encoding="utf-8"
    )
    assert "teacher_id" not in sql
    assert "activity_id" not in sql
    assert "connection_state" not in sql
    assert "v_session.status = 'ended'" in sql
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    preview = schema[schema.index("function public.get_session_join_preview") :]
    preview = preview[: preview.index("function public.set_participant_group_step")]
    assert "'teacher_id'" not in preview
    assert "v_session.status = 'ended'" in preview


def test_authenticated_rls_migration_covers_teacher_student_boundaries() -> None:
    sql = _normalized_sql(MIGRATION_PATH)
    for policy in (
        "activities_teacher_all",
        "sessions_scoped_read",
        "groups_scoped_read",
        "group_insights_scoped_read",
        "utterances_teacher_read",
        "help_requests_scoped_read",
    ):
        assert f"create policy {policy}" in sql

    assert "teacher_id = auth.uid()::text" in sql
    assert "create or replace function public.is_group_participant" in sql
    assert "create or replace function public.get_session_join_preview" in sql
    assert "create or replace function public.set_participant_group_step" in sql
    assert "create or replace function public.request_participant_help" in sql
    assert "create or replace function public.resolve_teacher_help" in sql
    assert "grant select, insert, delete on table public.groups, public.group_members" in sql
    assert "grant update on table public.groups" not in sql
    assert "grant insert on table public.help_requests" not in sql


def _postgres_required() -> bool:
    return os.getenv("REQUIRE_POSTGRES_TESTS", "").strip().lower() in {"1", "true", "yes"}


@pytest.mark.asyncio
async def test_local_catalog_has_no_open_policy_or_anon_table_grant() -> None:
    database_url = os.getenv("TEST_DATABASE_URL", "").strip()
    if not database_url:
        if _postgres_required():
            pytest.fail("TEST_DATABASE_URL is required for PostgreSQL security tests")
        pytest.skip("TEST_DATABASE_URL is not configured")

    connection = await asyncpg.connect(
        database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    )
    try:
        open_policies = await connection.fetch(
            """
            select tablename, policyname
            from pg_policies
            where schemaname = 'public'
              and (
                policyname like 'demo_open_%'
                or policyname like '%_anon_all'
                or coalesce(qual, '') = 'true'
                or coalesce(with_check, '') = 'true'
              )
            """
        )
        assert open_policies == []

        anon_grants = await connection.fetchval(
            """
            select count(*)
            from information_schema.role_table_grants
            where grantee = 'anon' and table_schema = 'public'
            """
        )
        assert anon_grants == 0

        assert not await connection.fetchval(
            "select has_table_privilege('authenticated', 'public.groups', 'update')"
        )
        assert not await connection.fetchval(
            "select has_table_privilege('authenticated', 'public.help_requests', 'insert')"
        )
        assert not await connection.fetchval(
            "select has_table_privilege('authenticated', 'public.utterances', 'insert')"
        )
    finally:
        await connection.close()
