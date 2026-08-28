import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from grouptalk_livekit_worker.api_client import (
    PermanentAPIError,
    RetryExhaustedError,
    SessionEndedError,
)
from grouptalk_livekit_worker.transcripts import (
    MissingSpeakerError,
    NormalizedTranscript,
    SpeakerLabeler,
    TranscriptEvent,
    normalize_final_transcript,
)


class AudioSource(Protocol):
    def __aiter__(self) -> AsyncIterator[object]: ...

    async def aclose(self) -> None: ...


class SpeechStream(Protocol):
    start_time: float
    start_time_offset: float

    def __aiter__(self) -> AsyncIterator[TranscriptEvent]: ...

    async def push_frame(self, frame: object) -> None: ...

    async def end_input(self) -> None: ...

    async def aclose(self) -> None: ...


class APIClient(Protocol):
    async def send(self, payload: dict[str, object]) -> None: ...


@dataclass(frozen=True, slots=True)
class PipelineOutcome:
    code: str


_QUEUE_END = object()


class QueueCapacityError(RuntimeError):
    pass


class GroupPipeline:
    def __init__(
        self,
        *,
        session_id: UUID,
        group_id: UUID,
        audio_source: AudioSource,
        speech_stream: SpeechStream,
        api_client: APIClient,
        queue_capacity: int = 64,
        shutdown_timeout: float = 10.0,
        event_id_factory: Callable[[], object] = uuid4,
    ) -> None:
        self._session_id = session_id
        self._group_id = group_id
        self._audio_source = audio_source
        self._speech_stream = speech_stream
        self._api_client = api_client
        self._queue: asyncio.Queue[NormalizedTranscript | object] = asyncio.Queue(queue_capacity)
        self._shutdown_timeout = shutdown_timeout
        self._event_id_factory = event_id_factory
        self._labeler = SpeakerLabeler()
        self._done = asyncio.Event()
        self._run_task: asyncio.Task[PipelineOutcome] | None = None
        self._audio_close_lock = asyncio.Lock()
        self._audio_closed = False

    async def run(self) -> PipelineOutcome:
        self._run_task = asyncio.current_task()
        failure: Exception | None = None
        try:
            async with asyncio.TaskGroup() as tasks:
                tasks.create_task(self._forward_audio())
                tasks.create_task(self._consume_transcripts())
                tasks.create_task(self._send_transcripts())
        except* Exception as error_group:
            failure = self._first_exception(error_group)
        finally:
            try:
                try:
                    await self._close_audio_once()
                except Exception as cleanup_error:
                    failure = failure or cleanup_error
                try:
                    await self._speech_stream.aclose()
                except Exception as cleanup_error:
                    failure = failure or cleanup_error
            finally:
                self._done.set()

        return PipelineOutcome(code=self._outcome_code(failure))

    async def close(self) -> PipelineOutcome:
        await self._close_audio_once()
        try:
            async with asyncio.timeout(self._shutdown_timeout):
                await self._done.wait()
        except TimeoutError:
            if self._run_task is not None:
                self._run_task.cancel()
                with suppress(asyncio.CancelledError):
                    await self._run_task
            return PipelineOutcome(code="shutdown_timeout")
        return PipelineOutcome(code="closed")

    async def _close_audio_once(self) -> None:
        async with self._audio_close_lock:
            if self._audio_closed:
                return
            self._audio_closed = True
            await self._audio_source.aclose()

    async def _forward_audio(self) -> None:
        try:
            async for frame in self._audio_source:
                await self._speech_stream.push_frame(frame)
        finally:
            await self._speech_stream.end_input()

    async def _consume_transcripts(self) -> None:
        async for event in self._speech_stream:
            normalized = normalize_final_transcript(
                event,
                labeler=self._labeler,
                stream_start_time=self._speech_stream.start_time,
                stream_start_time_offset=self._speech_stream.start_time_offset,
                event_id_factory=self._event_id_factory,
            )
            if normalized is None:
                continue
            try:
                self._queue.put_nowait(normalized)
            except asyncio.QueueFull as error:
                raise QueueCapacityError("transcript queue reached its capacity") from error
        await self._queue.put(_QUEUE_END)

    async def _send_transcripts(self) -> None:
        while True:
            item = await self._queue.get()
            try:
                if item is _QUEUE_END:
                    return
                assert isinstance(item, NormalizedTranscript)
                await self._api_client.send(self._payload(item))
            finally:
                self._queue.task_done()

    def _payload(self, transcript: NormalizedTranscript) -> dict[str, object]:
        return {
            "source_event_id": transcript.source_event_id,
            "session_id": str(self._session_id),
            "group_id": str(self._group_id),
            "speaker_label": transcript.speaker_label,
            "text": transcript.text,
            "spoken_at": self._isoformat(transcript.spoken_at),
        }

    @staticmethod
    def _isoformat(value: datetime) -> str:
        return value.isoformat().replace("+00:00", "Z")

    @classmethod
    def _first_exception(cls, error: BaseExceptionGroup) -> Exception:
        current: BaseException = error.exceptions[0]
        while isinstance(current, BaseExceptionGroup):
            current = current.exceptions[0]
        if isinstance(current, Exception):
            return current
        return RuntimeError("pipeline stopped")

    @staticmethod
    def _outcome_code(error: Exception | None) -> str:
        if error is None:
            return "completed"
        if isinstance(error, MissingSpeakerError):
            return "deepgram_contract"
        if isinstance(error, QueueCapacityError):
            return "queue_full"
        if isinstance(error, RetryExhaustedError):
            return "api_retry_exhausted"
        if isinstance(error, PermanentAPIError):
            return "api_permanent"
        if isinstance(error, SessionEndedError):
            return "session_ended"
        return "deepgram_failure"
