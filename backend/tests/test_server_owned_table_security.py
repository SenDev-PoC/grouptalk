import os
import re
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "supabase" / "schema.sql"
MIGRATION_PATH = ROOT / "supabase" / "migrations" / "20260829190000_secure_server_owned_tables.sql"


def _normalized_sql(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8")).strip().lower()


def _open_policy_targets(schema: str) -> str:
    start = schema.index("foreach target in array array[")
    end = schema.index("]", start)
    return schema[start:end]


def test_security_migration_is_append_only_and_locks_server_owned_tables() -> None:
    assert MIGRATION_PATH.exists()
    sql = _normalized_sql(MIGRATION_PATH)

    for table in ("utterances", "group_insights"):
        assert f"drop policy if exists demo_open_{table} on public.{table}" in sql
        assert (
            f"revoke insert, update, delete on table public.{table} from anon, authenticated"
        ) in sql
        assert f"grant select on table public.{table} to anon, authenticated" in sql

    assert "create policy utterances_demo_read" in sql
    assert "create policy group_insights_demo_read" in sql
    assert "for select to anon, authenticated using (true)" in sql
    assert "drop table" not in sql
    assert "drop publication" not in sql


def test_canonical_schema_keeps_server_owned_tables_out_of_open_policy_loop() -> None:
    schema = _normalized_sql(SCHEMA_PATH)
    targets = _open_policy_targets(schema)

    assert "'utterances'" not in targets
    assert "'group_insights'" not in targets

    for table, policy in (
        ("utterances", "utterances_demo_read"),
        ("group_insights", "group_insights_demo_read"),
    ):
        assert f"create policy {policy} on {table}" in schema
        assert f"grant select on table {table} to anon, authenticated" in schema
        assert (
            f"grant select, insert, update, delete on table {table} to anon, authenticated"
        ) not in schema

    assert "alter publication supabase_realtime add table group_insights" in schema


def _postgres_required() -> bool:
    return os.getenv("REQUIRE_POSTGRES_TESTS", "").strip().lower() in {"1", "true", "yes"}


async def _connect_to_test_database() -> asyncpg.Connection:
    database_url = os.getenv("TEST_DATABASE_URL", "").strip()
    if not database_url:
        if _postgres_required():
            pytest.fail("TEST_DATABASE_URL is required for PostgreSQL security tests")
        pytest.skip("TEST_DATABASE_URL is not configured")
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return await asyncpg.connect(database_url)


@pytest.mark.asyncio
async def test_client_roles_are_read_only_while_server_connection_can_write() -> None:
    connection = await _connect_to_test_database()
    activity_id = uuid4()
    session_id = uuid4()
    group_id = uuid4()
    insight_id = group_id

    try:
        await connection.execute(
            """
            insert into public.activities (id, teacher_id, title)
            values ($1, 'security-test-teacher', 'security test')
            """,
            activity_id,
        )
        await connection.execute(
            """
            insert into public.sessions (
              id, activity_id, teacher_id, title, join_code, status
            ) values ($1, $2, 'security-test-teacher', 'security test', $3, 'waiting')
            """,
            session_id,
            activity_id,
            f"S{uuid4().hex[:7]}",
        )
        await connection.execute(
            "insert into public.groups (id, session_id, name) values ($1, $2, 'security group')",
            group_id,
            session_id,
        )
        await connection.execute(
            "insert into public.utterances (session_id, group_id, text) values ($1, $2, 'seed')",
            session_id,
            group_id,
        )
        await connection.execute(
            "insert into public.group_insights (group_id, session_id) values ($1, $2)",
            insight_id,
            session_id,
        )

        for role in ("anon", "authenticated"):
            async with connection.transaction():
                await connection.execute(f"set local role {role}")
                assert (
                    await connection.fetchval(
                        "select count(*) from public.utterances where group_id = $1",
                        group_id,
                    )
                    == 1
                )
                assert (
                    await connection.fetchval(
                        "select count(*) from public.group_insights where group_id = $1",
                        group_id,
                    )
                    == 1
                )

            denied_statements = (
                (
                    "insert into public.utterances (session_id, group_id, text) "
                    "values ($1, $2, 'forged')",
                    session_id,
                    group_id,
                ),
                (
                    "update public.utterances set text = 'forged' where group_id = $1",
                    group_id,
                ),
                ("delete from public.utterances where group_id = $1", group_id),
                (
                    "insert into public.group_insights (group_id, session_id) values ($1, $2)",
                    uuid4(),
                    session_id,
                ),
                (
                    "update public.group_insights set summary = 'forged' where group_id = $1",
                    group_id,
                ),
                ("delete from public.group_insights where group_id = $1", group_id),
            )
            for statement in denied_statements:
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    async with connection.transaction():
                        await connection.execute(f"set local role {role}")
                        await connection.execute(statement[0], *statement[1:])

        await connection.execute(
            "update public.group_insights set summary = 'server update' where group_id = $1",
            group_id,
        )
        await connection.execute(
            "insert into public.utterances (session_id, group_id, text) values ($1, $2, 'server')",
            session_id,
            group_id,
        )
        assert (
            await connection.fetchval(
                "select count(*) from public.utterances where group_id = $1",
                group_id,
            )
            == 2
        )
    finally:
        try:
            await connection.execute("reset role")
            await connection.execute("delete from public.activities where id = $1", activity_id)
        finally:
            await connection.close()
