import asyncio
import pickle
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest
from livekit import agents, rtc

from grouptalk_livekit_worker import agent
from grouptalk_livekit_worker.config import WorkerSettings
from grouptalk_livekit_worker.pipeline import PipelineOutcome

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
GROUP_G = UUID("22222222-2222-4222-8222-222222222222")
GROUP_H = UUID("33333333-3333-4333-8333-333333333333")
TOKEN = "worker-test-token-with-at-least-32-characters"
LIVEKIT_API_KEY = "livekit-test-key"
LIVEKIT_API_SECRET = "livekit-test-secret"


def _settings() -> WorkerSettings:
    return WorkerSettings(
        _env_file=None,
        livekit_url="wss://test.livekit.cloud",
        livekit_api_key=LIVEKIT_API_KEY,
        livekit_api_secret=LIVEKIT_API_SECRET,
        grouptalk_api_url="https://api.example.com",
        worker_api_token=TOKEN,
        deepgram_api_key="deepgram-test-key",
    )


def test_server_is_named_room_worker_with_subscribe_only_hidden_permissions() -> None:
    server = agent.create_server(_settings())

    assert server._agent_name == "grouptalk-transcriber"
    assert server._ws_url == "wss://test.livekit.cloud"
    assert server._api_key == LIVEKIT_API_KEY
    assert server._api_secret == LIVEKIT_API_SECRET
    assert server._server_type == agents.WorkerType.ROOM
    assert server._drain_timeout == 30
    assert server._shutdown_process_timeout == 15.0
    assert server._permissions == agents.WorkerPermissions(
        can_subscribe=True,
        can_publish=False,
        can_publish_data=False,
        can_update_metadata=False,
        hidden=True,
    )


def test_server_entrypoint_can_be_spawned_in_a_worker_process() -> None:
    server = agent.create_server(_settings())

    pickle.dumps(server._entrypoint_fnc)


@pytest.mark.parametrize(
    ("kind", "source", "identity", "expected"),
    [
        (rtc.TrackKind.KIND_AUDIO, rtc.TrackSource.SOURCE_MICROPHONE, str(GROUP_G), GROUP_G),
        (rtc.TrackKind.KIND_VIDEO, rtc.TrackSource.SOURCE_CAMERA, str(GROUP_G), None),
        (rtc.TrackKind.KIND_AUDIO, rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO, str(GROUP_G), None),
        (rtc.TrackKind.KIND_AUDIO, rtc.TrackSource.SOURCE_MICROPHONE, "not-a-uuid", None),
    ],
)
def test_filters_non_microphone_and_invalid_group_tracks(kind, source, identity, expected) -> None:
    track = SimpleNamespace(kind=kind)
    publication = SimpleNamespace(source=source)
    participant = SimpleNamespace(identity=identity)

    assert agent.eligible_microphone_track(track, publication, participant) == expected


class FakePipeline:
    def __init__(self, code: str, *, wait_for_close: bool = False) -> None:
        self.code = code
        self.wait_for_close = wait_for_close
        self.closed = asyncio.Event()
        self.run_count = 0
        self.close_count = 0

    async def run(self) -> PipelineOutcome:
        self.run_count += 1
        if self.wait_for_close:
            await self.closed.wait()
        return PipelineOutcome(self.code)

    async def close(self) -> PipelineOutcome:
        self.close_count += 1
        self.closed.set()
        return PipelineOutcome("closed")


@pytest.mark.asyncio
async def test_registry_isolates_group_failures_and_closes_each_adapter_once() -> None:
    pipelines = {
        GROUP_G: FakePipeline("completed", wait_for_close=True),
        GROUP_H: FakePipeline("deepgram_failure"),
    }

    def factory(track, session_id, group_id):
        assert session_id == SESSION_ID
        return pipelines[group_id]

    registry = agent.RoomPipelineRegistry(factory)
    await registry.start(SimpleNamespace(sid="track-g"), SESSION_ID, GROUP_G)
    await registry.start(SimpleNamespace(sid="track-h"), SESSION_ID, GROUP_H)
    await asyncio.sleep(0)

    assert pipelines[GROUP_G].run_count == 1
    assert pipelines[GROUP_G].closed.is_set() is False
    assert pipelines[GROUP_H].run_count == 1

    await registry.close_all()

    assert pipelines[GROUP_G].close_count == 1
    assert pipelines[GROUP_H].close_count == 0


class FakeRoom:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.callbacks: dict[str, object] = {}

    def on(self, event_name: str):
        self.events.append(f"listener:{event_name}")

        def decorator(callback):
            self.callbacks[event_name] = callback
            return callback

        return decorator


class FakeJobContext:
    def __init__(self) -> None:
        self.events: list[str] = []
        self.room = FakeRoom(self.events)
        self.job = SimpleNamespace(room=SimpleNamespace(name=f"session_{SESSION_ID}"))
        self.shutdown_callback = None

    def add_shutdown_callback(self, callback) -> None:
        self.events.append("shutdown_registered")
        self.shutdown_callback = callback

    async def connect(self, *, auto_subscribe) -> None:
        self.events.append(f"connect:{auto_subscribe.value}")
        self.room.callbacks["disconnected"]("room_closed")


@pytest.mark.asyncio
async def test_room_registers_lifecycle_hooks_before_audio_only_connect() -> None:
    context = FakeJobContext()

    await agent.run_room(context, _settings(), pipeline_factory=lambda *_: None)

    assert context.events == [
        "listener:track_subscribed",
        "listener:track_unsubscribed",
        "listener:disconnected",
        "shutdown_registered",
        "connect:audio_only",
    ]


@pytest.mark.asyncio
async def test_invalid_room_name_fails_before_connect() -> None:
    context = FakeJobContext()
    context.job.room.name = "unexpected-room"

    with pytest.raises(ValueError, match="session_<UUID>"):
        await agent.run_room(context, _settings())

    assert context.events == []


def test_deepgram_factory_uses_korean_diarization_and_bounded_connection_retries(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeSTT:
        capabilities = SimpleNamespace(diarization=True)

        def __init__(self, **kwargs) -> None:
            captured["options"] = kwargs

        def stream(self, *, conn_options):
            captured["conn_options"] = conn_options
            return SimpleNamespace()

    monkeypatch.setattr(agent.deepgram, "STT", FakeSTT)
    monkeypatch.setattr(agent.rtc, "AudioStream", lambda track: SimpleNamespace(track=track))
    factory = agent.create_group_pipeline_factory(_settings(), SimpleNamespace())

    factory(SimpleNamespace(), SESSION_ID, GROUP_G)

    assert captured["options"] == {
        "model": "nova-3",
        "language": "ko",
        "interim_results": True,
        "punctuate": True,
        "smart_format": True,
        "enable_diarization": True,
        "endpointing_ms": 300,
        "mip_opt_out": True,
        "api_key": "deepgram-test-key",
    }
    connection_options = captured["conn_options"]
    assert connection_options.max_retry == 2
    assert connection_options.timeout == 10.0


def test_worker_has_no_direct_openai_or_agent_session_path() -> None:
    worker_root = Path(__file__).resolve().parents[1]
    pyproject = (worker_root / "pyproject.toml").read_text(encoding="utf-8")
    source = (worker_root / "src/grouptalk_livekit_worker/agent.py").read_text(encoding="utf-8")

    assert '"openai' not in pyproject.lower()
    assert "AgentSession" not in source
