"""Raw Deepgram streaming adapter that preserves word-level speaker changes."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Any

import aiohttp

from grouptalk_livekit_worker.transcripts import TranscriptEvent

DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen"
_INPUT_END = object()
logger = logging.getLogger(__name__)


class DeepgramStreamError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class DeepgramWord:
    text: str
    start_time: float
    end_time: float
    speaker_id: str | None

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise ValueError("word text must not be blank")
        if self.start_time < 0 or self.end_time <= self.start_time:
            raise ValueError("word timing must satisfy 0 <= start_time < end_time")


@dataclass(frozen=True, slots=True)
class DeepgramResult:
    is_final: bool
    request_id: str | None
    words: tuple[DeepgramWord, ...]


@dataclass(frozen=True, slots=True)
class SpeakerSegment:
    request_id: str | None
    speaker_id: str | None
    text: str
    start_time: float
    end_time: float


def _speaker_id(value: object) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    return raw if raw.upper().startswith("S") else f"S{raw}"


def _float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def parse_deepgram_result(payload: Mapping[str, Any]) -> DeepgramResult | None:
    if payload.get("type") != "Results":
        return None

    channel = payload.get("channel")
    if not isinstance(channel, Mapping):
        return None
    alternatives = channel.get("alternatives")
    if not isinstance(alternatives, list) or not alternatives:
        return None
    alternative = alternatives[0]
    if not isinstance(alternative, Mapping):
        return None

    metadata = payload.get("metadata")
    request_id: str | None = None
    if isinstance(metadata, Mapping) and metadata.get("request_id") is not None:
        request_id = str(metadata["request_id"])
    elif payload.get("request_id") is not None:
        request_id = str(payload["request_id"])

    parsed_words: list[DeepgramWord] = []
    raw_words = alternative.get("words")
    if isinstance(raw_words, list):
        for raw_word in raw_words:
            if not isinstance(raw_word, Mapping):
                continue
            text = str(raw_word.get("punctuated_word") or raw_word.get("word") or "").strip()
            start_time = _float(raw_word.get("start"))
            end_time = _float(raw_word.get("end"))
            if not text or start_time is None or end_time is None or end_time <= start_time:
                continue
            parsed_words.append(
                DeepgramWord(
                    text=text,
                    start_time=start_time,
                    end_time=end_time,
                    speaker_id=_speaker_id(raw_word.get("speaker")),
                )
            )

    if not parsed_words:
        transcript = str(alternative.get("transcript") or "").strip()
        start_time = _float(payload.get("start"))
        duration = _float(payload.get("duration"))
        if transcript and start_time is not None and duration is not None and duration > 0:
            parsed_words.append(
                DeepgramWord(
                    text=transcript,
                    start_time=start_time,
                    end_time=start_time + duration,
                    speaker_id=None,
                )
            )

    return DeepgramResult(
        is_final=bool(payload.get("is_final")),
        request_id=request_id,
        words=tuple(parsed_words),
    )


def split_speaker_segments(result: DeepgramResult) -> tuple[SpeakerSegment, ...]:
    if not result.is_final or not result.words:
        return ()

    segments: list[SpeakerSegment] = []
    words: list[DeepgramWord] = []

    def flush() -> None:
        if not words:
            return
        segments.append(
            SpeakerSegment(
                request_id=result.request_id,
                speaker_id=words[0].speaker_id,
                text=" ".join(word.text for word in words),
                start_time=words[0].start_time,
                end_time=words[-1].end_time,
            )
        )
        words.clear()

    for word in result.words:
        if words and word.speaker_id != words[-1].speaker_id:
            flush()
        words.append(word)
    flush()
    return tuple(segments)


def transcript_events_from_result(result: DeepgramResult) -> tuple[TranscriptEvent, ...]:
    return tuple(
        TranscriptEvent(
            final=True,
            text=segment.text,
            speaker_id=segment.speaker_id,
            start_time=segment.start_time,
        )
        for segment in split_speaker_segments(result)
    )


class DeepgramWordStream:
    """Push LiveKit PCM frames and yield final events split at word speaker changes."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "nova-3",
        language: str = "ko",
        sample_rate: int = 16_000,
        endpointing_ms: int = 300,
        url: str = DEEPGRAM_LISTEN_URL,
        retry_delays: tuple[float, ...] = (0.5, 1.0),
    ) -> None:
        if not api_key.strip():
            raise ValueError("Deepgram API key must not be blank")
        if any(delay < 0 for delay in retry_delays):
            raise ValueError("Deepgram retry delays must not be negative")
        self._api_key = api_key.strip()
        self._url = url
        self._retry_delays = retry_delays
        self._frames: asyncio.Queue[object] = asyncio.Queue(maxsize=256)
        self._input_ended = False
        self._audio_duration_sent = 0.0
        self.start_time = time.time()
        self.start_time_offset = 0.0
        self.query_params = {
            "model": model,
            "language": language,
            "encoding": "linear16",
            "sample_rate": str(sample_rate),
            "channels": "1",
            "interim_results": "true",
            "punctuate": "true",
            "smart_format": "true",
            "no_delay": "true",
            "endpointing": str(endpointing_ms),
            "diarize_model": "latest",
            "mip_opt_out": "true",
        }

    async def push_frame(self, frame: object) -> None:
        if self._input_ended:
            raise RuntimeError("cannot push audio after input ended")
        await self._frames.put(frame)

    async def end_input(self) -> None:
        if self._input_ended:
            return
        self._input_ended = True
        try:
            self._frames.put_nowait(_INPUT_END)
        except asyncio.QueueFull as error:
            raise DeepgramStreamError("Deepgram audio queue reached its capacity") from error

    async def aclose(self) -> None:
        await self.end_input()

    def __aiter__(self) -> AsyncIterator[TranscriptEvent]:
        return self._iterate()

    async def _iterate(self) -> AsyncIterator[TranscriptEvent]:
        timeout = aiohttp.ClientTimeout(total=None, connect=15, sock_read=None)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            consecutive_failures = 0
            while True:
                connection_offset = self._audio_duration_sent
                try:
                    websocket = await self._connect(session)
                    try:
                        async for event in self._iterate_connection(
                            websocket,
                            connection_offset=connection_offset,
                        ):
                            consecutive_failures = 0
                            yield event
                        return
                    finally:
                        if not websocket.closed:
                            await websocket.close()
                except asyncio.CancelledError:
                    raise
                except (TimeoutError, aiohttp.ClientError, DeepgramStreamError) as error:
                    if self._input_ended or consecutive_failures >= len(self._retry_delays):
                        raise DeepgramStreamError(
                            "Deepgram WebSocket connection retries exhausted"
                        ) from error
                    delay = self._retry_delays[consecutive_failures]
                    consecutive_failures += 1
                    logger.warning(
                        "deepgram_stream_reconnecting",
                        extra={
                            "event_code": "deepgram_stream_reconnecting",
                            "attempt": consecutive_failures,
                        },
                    )
                    await asyncio.sleep(delay)

    async def _iterate_connection(
        self,
        websocket: aiohttp.ClientWebSocketResponse,
        *,
        connection_offset: float,
    ) -> AsyncIterator[TranscriptEvent]:
        results: asyncio.Queue[DeepgramResult | BaseException | None] = asyncio.Queue()
        input_closed = asyncio.Event()

        async def send_audio() -> None:
            try:
                while True:
                    frame = await self._frames.get()
                    if frame is _INPUT_END:
                        break
                    data = getattr(frame, "data", None)
                    if data is None or not hasattr(data, "tobytes"):
                        raise TypeError("Deepgram stream requires a PCM audio frame")
                    await websocket.send_bytes(data.tobytes())
                    self._audio_duration_sent += self._frame_duration_seconds(frame)
                input_closed.set()
                if not websocket.closed:
                    await websocket.send_str(json.dumps({"type": "CloseStream"}))
            except asyncio.CancelledError:
                raise
            except BaseException as error:
                input_closed.set()
                await results.put(error)
                await websocket.close()

        async def send_keepalive() -> None:
            try:
                while not input_closed.is_set() and not websocket.closed:
                    await asyncio.sleep(4)
                    if not input_closed.is_set() and not websocket.closed:
                        await websocket.send_str(json.dumps({"type": "KeepAlive"}))
            except asyncio.CancelledError:
                raise
            except BaseException as error:
                await results.put(error)
                await websocket.close()

        async def receive_results() -> None:
            try:
                async for message in websocket:
                    if message.type == aiohttp.WSMsgType.TEXT:
                        payload = json.loads(message.data)
                        if payload.get("type") == "Error":
                            message_text = (
                                payload.get("description") or payload.get("message") or payload
                            )
                            raise DeepgramStreamError(str(message_text))
                        result = parse_deepgram_result(payload)
                        if result is not None:
                            await results.put(result)
                        elif payload.get("type") == "Metadata" and input_closed.is_set():
                            break
                    elif message.type == aiohttp.WSMsgType.ERROR:
                        raise DeepgramStreamError(str(websocket.exception()))
                    elif message.type in {
                        aiohttp.WSMsgType.CLOSE,
                        aiohttp.WSMsgType.CLOSED,
                        aiohttp.WSMsgType.CLOSING,
                    }:
                        if not input_closed.is_set():
                            raise DeepgramStreamError(
                                "Deepgram WebSocket closed before audio input ended"
                            )
                        break
                if not input_closed.is_set():
                    raise DeepgramStreamError("Deepgram WebSocket ended before audio input ended")
            except asyncio.CancelledError:
                raise
            except BaseException as error:
                await results.put(error)
            finally:
                await results.put(None)

        tasks = [
            asyncio.create_task(send_audio()),
            asyncio.create_task(send_keepalive()),
            asyncio.create_task(receive_results()),
        ]
        try:
            while True:
                item = await results.get()
                if item is None:
                    break
                if isinstance(item, BaseException):
                    raise item
                for event in transcript_events_from_result(item):
                    yield TranscriptEvent(
                        final=event.final,
                        text=event.text,
                        speaker_id=event.speaker_id,
                        start_time=connection_offset + event.start_time,
                    )
        finally:
            input_closed.set()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if not websocket.closed:
                await websocket.close()

    async def _connect(self, session: aiohttp.ClientSession) -> aiohttp.ClientWebSocketResponse:
        return await session.ws_connect(
            self._url,
            headers={"Authorization": f"Token {self._api_key}"},
            params=self.query_params,
            heartbeat=20,
        )

    @staticmethod
    def _frame_duration_seconds(frame: object) -> float:
        sample_rate = getattr(frame, "sample_rate", 0)
        samples_per_channel = getattr(frame, "samples_per_channel", 0)
        if not isinstance(sample_rate, int) or sample_rate <= 0:
            return 0.0
        if not isinstance(samples_per_channel, int) or samples_per_channel <= 0:
            return 0.0
        return samples_per_channel / sample_rate
