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
    def __init__(self, rows: list[dict[str, object]], scalar: int | None = None) -> None:
        self.rows = rows
        self.scalar = scalar

    def mappings(self) -> FakeMappings:
        return FakeMappings(self.rows)

    def scalar_one(self) -> int:
        assert self.scalar is not None
        return self.scalar


class FakeSession:
    def __init__(self, *, upserted: bool = True) -> None:
        self.upserted = upserted
        self.statements: list[str] = []
        self.parameters: list[dict[str, object]] = []
        self.rows = [
            {
                "id": UUID(int=index + 1),
                "speaker_label": "화자 A" if index == 0 else "화자 B",
                "spoken_at": BASE_TIME - timedelta(seconds=2 - index),
                "created_at": BASE_TIME + timedelta(microseconds=index),
                "start_ms": index * 5_000,
                "end_ms": index * 5_000 + (8_000 if index == 0 else 1_000),
            }
            for index in range(3)
        ]

    async def execute(self, statement, parameters) -> FakeResult:
        sql = str(statement)
        self.statements.append(sql)
        self.parameters.append(parameters)
        if "cross join latest" in sql:
            return FakeResult(self.rows)
        if "count(*) from group_members" in sql:
            return FakeResult([], scalar=2)
        if "select participation_alert_state" in sql:
            return FakeResult([])
        if "insert into group_insights" in sql:
            return FakeResult([{"group_id": GROUP_ID}] if self.upserted else [])
        raise AssertionError(f"unexpected SQL: {sql}")


@pytest.mark.asyncio
async def test_projection_loads_duration_window_members_and_alert_state() -> None:
    session = FakeSession()

    changed = await project_realtime_participation(session, SESSION_ID, GROUP_ID)

    assert changed is True
    load_sql, member_sql, alert_sql, upsert_sql = session.statements
    assert "interval '120 seconds'" in load_sql
    assert "start_ms is not null" in load_sql
    assert "limit 20" not in load_sql.lower()
    assert "count(*) from group_members" in member_sql
    assert "participation_alert_state" in alert_sql
    assert "on conflict (group_id)" in upsert_sql
    conflict_update = upsert_sql.split("on conflict (group_id)", 1)[1]
    assert "summary = excluded.summary" not in conflict_update
    assert "keywords = excluded.keywords" not in conflict_update

    parameters = session.parameters[3]
    assert parameters["participation_state"] == "skewed"
    assert parameters["participation_equity"] == pytest.approx(0.7)
    assert parameters["total_speaking_ms"] == 10_000
    assert parameters["joined_participant_count"] == 2
    assert parameters["silent_participant_count"] == 0
    assert parameters["participation_alert_state"] == "NORMAL"
    assert parameters["analysis_version"] == "participation-duration-v1"
    assert json.loads(str(parameters["speaker_shares"])) == [
        {
            "speaker_label": "화자 A",
            "ratio": 0.8,
            "utterance_count": 1,
            "speaking_time_ms": 8_000,
        },
        {
            "speaker_label": "화자 B",
            "ratio": 0.2,
            "utterance_count": 2,
            "speaking_time_ms": 2_000,
        },
    ]


@pytest.mark.asyncio
async def test_projection_reports_no_change_when_upsert_is_a_noop() -> None:
    session = FakeSession(upserted=False)

    changed = await project_realtime_participation(session, SESSION_ID, GROUP_ID)

    assert changed is False
