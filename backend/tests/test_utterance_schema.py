import os
import re
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "supabase" / "schema.sql"
MIGRATIONS_PATH = ROOT / "supabase" / "migrations"
MIGRATION_GLOB = "*_live_utterances.sql"
REALTIME_ANALYSIS_MIGRATION = MIGRATIONS_PATH / "20260829130000_realtime_analysis_window.sql"


def _migration_path() -> Path:
    matches = sorted(MIGRATIONS_PATH.glob(MIGRATION_GLOB))
    assert len(matches) == 1, f"expected one {MIGRATION_GLOB} migration, found {len(matches)}"
    return matches[0]


def _normalized_sql(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8")).strip().lower()


def test_migration_versions_are_unique() -> None:
    versions = [path.name.split("_", 1)[0] for path in MIGRATIONS_PATH.glob("*.sql")]

    assert len(versions) == len(set(versions))


def test_canonical_schema_declares_live_utterance_invariants() -> None:
    schema = _normalized_sql(SCHEMA_PATH)

    assert "source_event_id text" in schema
    assert "constraint utterances_data_source_check" in schema
    assert "check (data_source in ('synthetic', 'live'))" in schema
    assert "constraint utterances_source_event_shape_check" in schema
    assert "create unique index if not exists utterances_live_event_key" in schema
    assert "where source_event_id is not null" in schema


def test_migration_replaces_the_old_check_before_adding_live_constraints() -> None:
    migration = _normalized_sql(_migration_path())

    drop_position = migration.index("drop constraint utterances_data_source_check")
    source_check_position = migration.index("add constraint utterances_data_source_check")
    shape_check_position = migration.index("add constraint utterances_source_event_shape_check")
    index_position = migration.index("create unique index utterances_live_event_key")

    assert drop_position < source_check_position < shape_check_position < index_position
    assert "group_insights" not in migration


def test_realtime_analysis_window_index_matches_the_canonical_schema() -> None:
    schema = _normalized_sql(SCHEMA_PATH)
    migration = _normalized_sql(REALTIME_ANALYSIS_MIGRATION)
    expected = (
        "utterances_live_analysis_window_idx on utterances "
        "(session_id, group_id, spoken_at desc, created_at desc, id desc) "
        "where data_source = 'live'"
    )

    assert expected in schema
    assert expected in migration


def _postgres_required() -> bool:
    return os.getenv("REQUIRE_POSTGRES_TESTS", "").strip().lower() in {"1", "true", "yes"}


async def _connect_to_test_database() -> asyncpg.Connection:
    database_url = os.getenv("TEST_DATABASE_URL", "").strip()
    if not database_url:
        if _postgres_required():
            pytest.fail("TEST_DATABASE_URL is required for PostgreSQL migration tests")
        pytest.skip("TEST_DATABASE_URL is not configured")
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)

    try:
        return await asyncpg.connect(database_url)
    except Exception:
        pytest.fail("could not connect to the dedicated PostgreSQL test database")


@pytest.mark.asyncio
async def test_migration_preserves_synthetic_rows_and_enforces_live_keys() -> None:
    connection = await _connect_to_test_database()
    schema_name = f"utterance_test_{uuid4().hex}"
    quoted_schema = f'"{schema_name}"'

    try:
        await connection.execute(f"create schema {quoted_schema}")
        await connection.execute("select set_config('search_path', $1, false)", schema_name)
        await connection.execute(
            """
            create table utterances (
              id uuid primary key,
              session_id uuid not null,
              group_id uuid not null,
              speaker_label text not null,
              text text not null,
              data_source text not null default 'synthetic' check (data_source = 'synthetic'),
              spoken_at timestamptz not null default now(),
              created_at timestamptz not null default now()
            )
            """
        )

        session_id = uuid4()
        group_id = uuid4()
        original_id = uuid4()
        await _insert_utterance(connection, original_id, session_id, group_id, "synthetic", None)

        await connection.execute(_migration_path().read_text(encoding="utf-8"))

        preserved = await connection.fetchval(
            "select count(*) from utterances where id = $1 and source_event_id is null",
            original_id,
        )
        assert preserved == 1

        await _insert_utterance(connection, uuid4(), session_id, group_id, "synthetic", None)
        await _insert_utterance(connection, uuid4(), session_id, group_id, "live", "event-1")

        with pytest.raises(asyncpg.CheckViolationError):
            await _insert_utterance(
                connection,
                uuid4(),
                session_id,
                group_id,
                "synthetic",
                "synthetic-must-not-have-an-event-id",
            )

        for invalid_event_id in (None, "", "x" * 129):
            with pytest.raises(asyncpg.CheckViolationError):
                await _insert_utterance(
                    connection,
                    uuid4(),
                    session_id,
                    group_id,
                    "live",
                    invalid_event_id,
                )

        with pytest.raises(asyncpg.UniqueViolationError):
            await _insert_utterance(
                connection,
                uuid4(),
                session_id,
                group_id,
                "live",
                "event-1",
            )
    finally:
        try:
            await connection.execute("select set_config('search_path', 'public', false)")
            await connection.execute(f"drop schema if exists {quoted_schema} cascade")
        finally:
            await connection.close()


async def _insert_utterance(
    connection: asyncpg.Connection,
    row_id: UUID,
    session_id: UUID,
    group_id: UUID,
    data_source: str,
    source_event_id: str | None,
) -> None:
    columns = "id, session_id, group_id, speaker_label, text, data_source"
    values = "$1, $2, $3, '화자 A', '테스트 전사', $4"
    arguments: list[object] = [row_id, session_id, group_id, data_source]
    if source_event_id is not None:
        columns += ", source_event_id"
        values += ", $5"
        arguments.append(source_event_id)

    await connection.execute(
        f"insert into utterances ({columns}) values ({values})",
        *arguments,
    )
