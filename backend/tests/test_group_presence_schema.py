import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = ROOT / "supabase" / "schema.sql"
MIGRATION_GLOB = "*_secure_group_presence.sql"


def _migration_path() -> Path:
    matches = sorted((ROOT / "supabase" / "migrations").glob(MIGRATION_GLOB))
    assert len(matches) == 1, f"expected one {MIGRATION_GLOB} migration, found {len(matches)}"
    return matches[0]


def _normalized_sql(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8")).strip().lower()


@pytest.mark.parametrize("path", [SCHEMA_PATH, pytest.param(None, id="migration")])
def test_group_presence_uses_database_time_and_validates_state(path: Path | None) -> None:
    sql = _normalized_sql(path or _migration_path())

    assert "function public.report_group_presence" in sql
    assert "security definer" in sql
    assert "set search_path = pg_catalog, public" in sql
    assert "requested_client_device_key text" in sql
    assert "auth.uid()" in sql
    assert "requested_connection_state not in ('not_ready', 'connecting', 'live', 'lost')" in sql
    assert "update public.groups" in sql
    assert "last_seen_at = v_now" in sql
    assert "grant execute on function public.report_group_presence(uuid, text, text)" in sql
