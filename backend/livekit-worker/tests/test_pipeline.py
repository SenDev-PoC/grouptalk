import asyncio
from collections.abc import AsyncIterator
from uuid import UUID

import pytest

from grouptalk_livekit_worker.api_client import RetryExhaustedError
from grouptalk_livekit_worker.pipeline import GroupPipeline
from grouptalk_livekit_worker.transcripts import TranscriptEvent

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
GROUP_ID = UUID("22222222-2222-4222-8222-222222222222")


class FakeAudioSource:
    def __init__(self, frames: list[bytes], events: list[str]) -> None:
        self.frames = frames
        self.events = events
        self.closed = False

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[bytes]:
        for frame in self.frames:
            yield frame

    async def aclose(self) -> None:
        self.closed = True
        self.events.append("audio_closed")


class FakeSpeechStream:
    def __init__(
        self,
        transcripts: list[TranscriptEvent],
        events: list[str],
        *,
        start_time: float = 1_800_000_000.0,
        start_time_offset: float = 0.0,
        failure: Exception | None = None,
    ) -> None:
        self.transcripts = transcripts
        self.events = events
        self.start_time = start_time
        self.start_time_offset = start_time_offset
        self.failure = failure
        self.input_ended = asyncio.Event()

    async def push_frame(self, frame: bytes) -> None:
        self.events.append(f"frame:{frame.decode()}")

    async def end_input(self) -> None:
        self.events.append("input_ended")
        self.input_ended.set()

    def __aiter__(self) -> AsyncIterator[TranscriptEvent]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[TranscriptEvent]:
        await self.input_ended.wait()
        if self.failure is not None:
            raise self.failure
        for transcript in self.transcripts:
            yield transcript

    async def aclose(self) -> None:
        self.events.append("stream_closed")


class FakeAPIClient:
    def __init__(self, events: list[str]) -> None:
        self.payloads: list[dict[str, object]] = []
        self.events = events

    async def send(self, payload: dict[str, object]) -> None:
        self.payloads.append(payload)
        self.events.append("api_sent")


class BlockingAudioSource:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.started = asyncio.Event()
        self.released = asyncio.Event()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[bytes]:
        self.started.set()
        await self.released.wait()
        if False:
            yield b""

    async def aclose(self) -> None:
        self.events.append("audio_closed")
        self.released.set()


class FailingAPIClient:
    async def send(self, payload: dict[str, object]) -> None:
        raise RetryExhaustedError("retries exhausted")


def _pipeline(
    transcript_events: list[TranscriptEvent],
    *,
    stream_failure: Exception | None = None,
) -> tuple[GroupPipeline, FakeAPIClient, list[str]]:
    events: list[str] = []
    audio = FakeAudioSource([b"one", b"two"], events)
    stream = FakeSpeechStream(transcript_events, events, failure=stream_failure)
    api_client = FakeAPIClient(events)
    pipeline = GroupPipeline(
        session_id=SESSION_ID,
        group_id=GROUP_ID,
        audio_source=audio,
        speech_stream=stream,
        api_client=api_client,
        event_id_factory=iter(["event-1", "event-2", "event-3"]).__next__,
    )
    return pipeline, api_client, events


@pytest.mark.asyncio
async def test_sends_only_non_empty_final_transcripts_and_preserves_group_scope() -> None:
    pipeline, api_client, events = _pipeline(
        [
            TranscriptEvent(final=False, text="중간", speaker_id=1, start_time=1.0),
            TranscriptEvent(final=True, text="첫 발화", speaker_id=1, start_time=2.0),
            TranscriptEvent(final=True, text="둘째 발화", speaker_id=0, start_time=3.0),
            TranscriptEvent(final=True, text="셋째 발화", speaker_id=1, start_time=4.0),
        ]
    )

    outcome = await pipeline.run()

    assert outcome.code == "completed"
    assert [payload["speaker_label"] for payload in api_client.payloads] == [
        "화자 A",
        "화자 B",
        "화자 A",
    ]
    assert {payload["session_id"] for payload in api_client.payloads} == {str(SESSION_ID)}
    assert {payload["group_id"] for payload in api_client.payloads} == {str(GROUP_ID)}
    assert [payload["source_event_id"] for payload in api_client.payloads] == [
        "event-1",
        "event-2",
        "event-3",
    ]
    assert events[-1] == "stream_closed"


@pytest.mark.asyncio
async def test_missing_speaker_and_provider_failure_are_local_pipeline_failures() -> None:
    good, good_api, _ = _pipeline(
        [TranscriptEvent(final=True, text="정상", speaker_id=0, start_time=1.0)]
    )
    bad, bad_api, _ = _pipeline(
        [TranscriptEvent(final=True, text="화자 없음", speaker_id=None, start_time=1.0)]
    )

    good_outcome, bad_outcome = await asyncio.gather(good.run(), bad.run())

    assert good_outcome.code == "completed"
    assert len(good_api.payloads) == 1
    assert bad_outcome.code == "deepgram_contract"
    assert bad_api.payloads == []

    failed_stream, _, _ = _pipeline([], stream_failure=RuntimeError("provider failed"))
    assert (await failed_stream.run()).code == "deepgram_failure"


@pytest.mark.asyncio
async def test_queue_overflow_and_api_exhaustion_have_explicit_outcomes() -> None:
    events: list[str] = []
    overflowing = GroupPipeline(
        session_id=SESSION_ID,
        group_id=GROUP_ID,
        audio_source=FakeAudioSource([], events),
        speech_stream=FakeSpeechStream(
            [
                TranscriptEvent(final=True, text="하나", speaker_id=0, start_time=1.0),
                TranscriptEvent(final=True, text="둘", speaker_id=0, start_time=2.0),
            ],
            events,
        ),
        api_client=FakeAPIClient(events),
        queue_capacity=1,
    )
    assert (await overflowing.run()).code == "queue_full"

    exhausted = GroupPipeline(
        session_id=SESSION_ID,
        group_id=GROUP_ID,
        audio_source=FakeAudioSource([], events),
        speech_stream=FakeSpeechStream(
            [TranscriptEvent(final=True, text="전송", speaker_id=0, start_time=1.0)],
            events,
        ),
        api_client=FailingAPIClient(),
    )
    assert (await exhausted.run()).code == "api_retry_exhausted"


@pytest.mark.asyncio
async def test_close_stops_audio_then_finalizes_and_closes_the_stream() -> None:
    events: list[str] = []
    audio = BlockingAudioSource(events)
    stream = FakeSpeechStream([], events)
    pipeline = GroupPipeline(
        session_id=SESSION_ID,
        group_id=GROUP_ID,
        audio_source=audio,
        speech_stream=stream,
        api_client=FakeAPIClient(events),
        shutdown_timeout=1.0,
    )

    run_task = asyncio.create_task(pipeline.run())
    await audio.started.wait()
    close_outcome = await pipeline.close()
    run_outcome = await run_task

    assert close_outcome.code == "closed"
    assert run_outcome.code == "completed"
    assert (
        events.index("audio_closed") < events.index("input_ended") < events.index("stream_closed")
    )
