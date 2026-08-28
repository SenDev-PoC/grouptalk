import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from api.realtime_analysis.service import project_realtime_participation

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
GROUP_ID = UUID("22222222-2222-4222-8222-222222222222")
BASE_TIME = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


class FakeMappings:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    def all(self) -> list[dict[str, object]]:
        return self.rows

    def one_or_none(self) -> dict[str, object] | None:
        return self.rows[0] if self.rows else None


class FakeResult:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    def mappings(self) -> FakeMappings:
        return FakeMappings(self.rows)


class FakeSession:
    def __init__(self, *, upserted: bool = True) -> None:
        self.upserted = upserted
        self.statements: list[str] = []
        self.parameters: list[dict[str, object]] = []
        self.rows = [
            {
                "id": UUID(int=index + 1),
                "speaker_label": "화자 A" if index < 8 else "화자 B",
                "spoken_at": BASE_TIME - timedelta(seconds=index),
                "created_at": BASE_TIME + timedelta(microseconds=index),
            }
            for index in range(10)
        ]

    async def execute(self, statement, parameters) -> FakeResult:
        sql = str(statement)
        self.statements.append(sql)
        self.parameters.append(parameters)
        if "from utterances" in sql:
            return FakeResult(self.rows)
        if "insert into group_insights" in sql:
            return FakeResult([{"group_id": GROUP_ID}] if self.upserted else [])
        raise AssertionError(f"unexpected SQL: {sql}")


@pytest.mark.asyncio
async def test_projection_loads_window_and_upserts_full_live_contract() -> None:
    session = FakeSession()

    changed = await project_realtime_participation(session, SESSION_ID, GROUP_ID)

    assert changed is True
    load_sql, upsert_sql = session.statements
    assert "data_source = 'live'" in load_sql
    assert "interval '5 minutes'" in load_sql
    assert "limit 20" in load_sql.lower()
    assert "on conflict (group_id)" in upsert_sql
    assert "is distinct from" in upsert_sql.lower()

    parameters = session.parameters[1]
    assert parameters["participation_state"] == "skewed"
    assert parameters["data_sufficiency"] == "sufficient"
    assert parameters["judgability"] == "judgable"
    assert parameters["reason_code"] is None
    assert parameters["observation_count"] == 10
    assert parameters["analysis_version"] == "participation-count-v1"
    assert parameters["evidence_from"] == BASE_TIME - timedelta(seconds=9)
    assert parameters["evidence_to"] == BASE_TIME
    assert json.loads(str(parameters["speaker_shares"])) == [
        {"speaker_label": "화자 A", "ratio": 0.8, "utterance_count": 8},
        {"speaker_label": "화자 B", "ratio": 0.2, "utterance_count": 2},
    ]


@pytest.mark.asyncio
async def test_projection_reports_no_change_when_upsert_is_a_noop() -> None:
    session = FakeSession(upserted=False)

    changed = await project_realtime_participation(session, SESSION_ID, GROUP_ID)

    assert changed is False
