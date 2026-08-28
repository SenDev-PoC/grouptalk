import asyncio
from collections.abc import AsyncIterator
from types import TracebackType
from uuid import UUID, uuid4

import httpx
import pytest
from grouptalk_livekit_worker.api_client import UtteranceAPIClient
from grouptalk_livekit_worker.pipeline import GroupPipeline
from grouptalk_livekit_worker.transcripts import TranscriptEvent

from api.config import get_settings
from api.database import get_db_session
from api.main import create_app

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
GROUP_G = UUID("22222222-2222-4222-8222-222222222222")
GROUP_H = UUID("33333333-3333-4333-8333-333333333333")
TOKEN = "worker-test-token-with-at-least-32-characters"


class FakeMappings:
    def __init__(self, row: dict[str, object] | list[dict[str, object]] | None) -> None:
        self.row = row

    def one_or_none(self) -> dict[str, object] | None:
        if isinstance(self.row, list):
            return self.row[0] if self.row else None
        return self.row

    def all(self) -> list[dict[str, object]]:
        if isinstance(self.row, list):
            return self.row
        return [] if self.row is None else [self.row]


class FakeResult:
    def __init__(
        self,
        row: dict[str, object] | list[dict[str, object]] | None,
        *,
        scalar: int | None = None,
    ) -> None:
        self.row = row
        self.scalar = scalar

    def mappings(self) -> FakeMappings:
        return FakeMappings(self.row)

    def scalar_one(self) -> int:
        assert self.scalar is not None
        return self.scalar


class FakeTransaction:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None


class InMemoryUtteranceSession:
    def __init__(self) -> None:
        self.rows: dict[tuple[object, object, object], dict[str, object]] = {}
        self.statements: list[str] = []
        self.group_insights_snapshot: dict[object, dict[str, object]] = {}

    def begin(self) -> FakeTransaction:
        return FakeTransaction()

    async def execute(self, statement, parameters) -> FakeResult:
        sql = str(statement)
        self.statements.append(sql)

        if "pg_advisory_xact_lock" in sql:
            return FakeResult(None)

        if "from sessions" in sql:
            exists = parameters["session_id"] == SESSION_ID and parameters["group_id"] in {
                GROUP_G,
                GROUP_H,
            }
            return FakeResult({"status": "active"} if exists else None)

        if "insert into utterances" in sql:
            key = (
                parameters["session_id"],
                parameters["group_id"],
                parameters["source_event_id"],
            )
            if key in self.rows:
                return FakeResult(None)
            row = {
                "id": uuid4(),
                "session_id": parameters["session_id"],
                "group_id": parameters["group_id"],
                "source_event_id": parameters["source_event_id"],
                "speaker_label": parameters["speaker_label"],
                "text": parameters["text"],
                "spoken_at": parameters["spoken_at"],
                "start_ms": parameters["start_ms"],
                "end_ms": parameters["end_ms"],
                "created_at": parameters["spoken_at"],
                "data_source": "live",
            }
            self.rows[key] = row
            return FakeResult({"id": row["id"]})
        if "with latest as" in sql:
            rows = [
                {
                    "id": row["id"],
                    "speaker_label": row["speaker_label"],
                    "spoken_at": row["spoken_at"],
                    "created_at": row["created_at"],
                    "start_ms": row["start_ms"],
                    "end_ms": row["end_ms"],
                }
                for row in self.rows.values()
                if row["session_id"] == parameters["session_id"]
                and row["group_id"] == parameters["group_id"]
            ]
            return FakeResult(rows)
        if "count(*) from group_members" in sql:
            return FakeResult(None, scalar=4)
        if "select participation_alert_state" in sql:
            return FakeResult(None)
        if "insert into group_insights" in sql:
            self.group_insights_snapshot[parameters["group_id"]] = dict(parameters)
            return FakeResult({"group_id": parameters["group_id"]})
        if "from utterances" in sql:
            key = (
                parameters["session_id"],
                parameters["group_id"],
                parameters["source_event_id"],
            )
            return FakeResult(self.rows.get(key))
        raise AssertionError(f"unexpected SQL: {sql}")


class FakeAudioSource:
    def __init__(self) -> None:
        self.close_count = 0

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[bytes]:
        yield b"ephemeral-audio-frame"

    async def aclose(self) -> None:
        self.close_count += 1


class FakeSpeechStream:
    def __init__(
        self,
        events: list[TranscriptEvent],
        *,
        fail_after_send: object | None = None,
    ) -> None:
        self.events = events
        self.fail_after_send = fail_after_send
        self.start_time = 1_800_000_000.0
        self.start_time_offset = 0.0
        self.ended = asyncio.Event()
        self.close_count = 0

    async def push_frame(self, frame: object) -> None:
        return None

    async def end_input(self) -> None:
        self.ended.set()

    def __aiter__(self) -> AsyncIterator[TranscriptEvent]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[TranscriptEvent]:
        await self.ended.wait()
        for event in self.events:
            yield event
        if self.fail_after_send is not None:
            await self.fail_after_send.wait()
            raise RuntimeError("fake provider failure")

    async def aclose(self) -> None:
        self.close_count += 1


class RecordingHTTPClient:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.payloads: list[dict[str, object]] = []
        self.h_send = asyncio.Event()

    async def post(self, url: str, **kwargs) -> httpx.Response:
        payload = dict(kwargs["json"])
        self.payloads.append(payload)
        response = await self.client.post(url, **kwargs)
        if payload["group_id"] == str(GROUP_H):
            self.h_send.set()
        return response


@pytest.mark.asyncio
async def test_two_group_fake_livekit_deepgram_api_db_vertical(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    get_settings.cache_clear()
    application = create_app()
    database = InMemoryUtteranceSession()

    async def override_db_session() -> AsyncIterator[InMemoryUtteranceSession]:
        yield database

    application.dependency_overrides[get_db_session] = override_db_session

    try:
        async with application.router.lifespan_context(application):
            transport = httpx.ASGITransport(app=application)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
                recording_http = RecordingHTTPClient(http)
                api_client = UtteranceAPIClient(
                    base_url="http://test",
                    token=TOKEN,
                    http_client=recording_http,
                )
                g_audio = FakeAudioSource()
                h_audio = FakeAudioSource()
                g_stream = FakeSpeechStream(
                    [
                        TranscriptEvent(True, "G 첫 발화", 1, 1.0, 1.8),
                        TranscriptEvent(False, "G 중간 결과", 1, 1.5, 1.9),
                        TranscriptEvent(True, "G 둘째 발화", 0, 2.0, 2.8),
                        TranscriptEvent(True, "G 셋째 발화", 1, 3.0, 3.8),
                    ]
                )
                h_stream = FakeSpeechStream(
                    [TranscriptEvent(True, "H 첫 발화", 8, 1.0, 1.8)],
                    fail_after_send=recording_http.h_send,
                )
                event_ids = iter(["g-1", "g-2", "g-3", "h-1"])
                g_pipeline = GroupPipeline(
                    session_id=SESSION_ID,
                    group_id=GROUP_G,
                    audio_source=g_audio,
                    speech_stream=g_stream,
                    api_client=api_client,
                    event_id_factory=event_ids.__next__,
                )
                h_pipeline = GroupPipeline(
                    session_id=SESSION_ID,
                    group_id=GROUP_H,
                    audio_source=h_audio,
                    speech_stream=h_stream,
                    api_client=api_client,
                    event_id_factory=event_ids.__next__,
                )

                g_outcome, h_outcome = await asyncio.gather(g_pipeline.run(), h_pipeline.run())
                first_g_payload = next(
                    payload
                    for payload in recording_http.payloads
                    if payload["group_id"] == str(GROUP_G)
                )
                await api_client.send(first_g_payload)
    finally:
        get_settings.cache_clear()

    rows = list(database.rows.values())
    g_rows = [row for row in rows if row["group_id"] == GROUP_G]
    h_rows = [row for row in rows if row["group_id"] == GROUP_H]

    assert g_outcome.code == "completed"
    assert h_outcome.code == "deepgram_failure"
    assert len(g_rows) == 3
    assert len(h_rows) == 1
    assert [row["speaker_label"] for row in g_rows] == ["화자 A", "화자 B", "화자 A"]
    assert [row["speaker_label"] for row in h_rows] == ["화자 A"]
    assert len({row["source_event_id"] for row in rows}) == 4
    assert g_audio.close_count == h_audio.close_count == 1
    assert g_stream.close_count == h_stream.close_count == 1
    assert database.group_insights_snapshot[GROUP_G]["participation_state"] == "skewed"
    assert database.group_insights_snapshot[GROUP_G]["observation_count"] == 3
    assert database.group_insights_snapshot[GROUP_H]["participation_state"] == "skewed"
    assert database.group_insights_snapshot[GROUP_H]["observation_count"] == 1
    assert all("audio" not in row for row in rows)
