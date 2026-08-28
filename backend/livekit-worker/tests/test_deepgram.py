import asyncio
import json
from types import SimpleNamespace

import aiohttp
import pytest

from grouptalk_livekit_worker.deepgram import (
    DeepgramWordStream,
    parse_deepgram_result,
    split_speaker_segments,
    transcript_events_from_result,
)


def _mixed_speaker_payload() -> dict[str, object]:
    return {
        "type": "Results",
        "is_final": True,
        "metadata": {"request_id": "request-1"},
        "channel": {
            "alternatives": [
                {
                    "transcript": "첫째 발화 둘째 발화",
                    "words": [
                        {
                            "word": "첫째",
                            "punctuated_word": "첫째",
                            "start": 0.1,
                            "end": 0.3,
                            "speaker": 0,
                        },
                        {"word": "발화", "start": 0.32, "end": 0.6, "speaker": 0},
                        {"word": "둘째", "start": 0.62, "end": 0.9, "speaker": 1},
                        {
                            "word": "발화",
                            "punctuated_word": "발화.",
                            "start": 0.92,
                            "end": 1.2,
                            "speaker": 1,
                        },
                    ],
                }
            ]
        },
    }


def test_parse_result_preserves_word_level_speakers_and_timing() -> None:
    result = parse_deepgram_result(_mixed_speaker_payload())

    assert result is not None
    assert result.is_final is True
    assert result.request_id == "request-1"
    assert [word.speaker_id for word in result.words] == ["S0", "S0", "S1", "S1"]
    assert result.words[0].text == "첫째"
    assert (result.words[-1].start_time, result.words[-1].end_time) == (0.92, 1.2)


def test_mixed_speaker_final_is_split_before_pipeline_normalization() -> None:
    result = parse_deepgram_result(_mixed_speaker_payload())

    assert result is not None
    segments = split_speaker_segments(result)
    events = transcript_events_from_result(result)

    assert [(segment.speaker_id, segment.text) for segment in segments] == [
        ("S0", "첫째 발화"),
        ("S1", "둘째 발화."),
    ]
    assert [(event.speaker_id, event.text, event.start_time) for event in events] == [
        ("S0", "첫째 발화", 0.1),
        ("S1", "둘째 발화.", 0.62),
    ]


def test_stream_requests_raw_word_diarization() -> None:
    stream = DeepgramWordStream(api_key="secret")

    assert stream.query_params["diarize_model"] == "latest"
    assert "diarize" not in stream.query_params
    assert stream.query_params["encoding"] == "linear16"
    assert stream.query_params["sample_rate"] == "16000"
    assert stream.query_params["channels"] == "1"
    assert stream.query_params["mip_opt_out"] == "true"


class _FakeWebSocket:
    def __init__(self, *, disconnect_after_first_audio: bool = False) -> None:
        self.disconnect_after_first_audio = disconnect_after_first_audio
        self.closed = False
        self.sent_audio: list[bytes] = []
        self.audio_sent = asyncio.Event()
        self._messages: asyncio.Queue[object | None] = asyncio.Queue()

    async def send_bytes(self, data: bytes) -> None:
        self.sent_audio.append(data)
        self.audio_sent.set()
        if self.disconnect_after_first_audio:
            self.closed = True
            await self._messages.put(SimpleNamespace(type=aiohttp.WSMsgType.CLOSED))
            return
        await self._messages.put(
            SimpleNamespace(
                type=aiohttp.WSMsgType.TEXT,
                data=json.dumps(_mixed_speaker_payload()),
            )
        )

    async def send_str(self, data: str) -> None:
        if json.loads(data).get("type") == "CloseStream":
            await self._messages.put(
                SimpleNamespace(
                    type=aiohttp.WSMsgType.TEXT,
                    data=json.dumps({"type": "Metadata"}),
                )
            )

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        await self._messages.put(None)

    def exception(self) -> None:
        return None

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        while True:
            message = await self._messages.get()
            if message is None:
                return
            yield message


class _FakeClientSession:
    def __init__(self, websockets: list[_FakeWebSocket]) -> None:
        self.websockets = websockets
        self.connect_count = 0
        self.reconnected = asyncio.Event()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        return None

    async def ws_connect(self, *args, **kwargs):
        websocket = self.websockets[self.connect_count]
        self.connect_count += 1
        if self.connect_count == 2:
            self.reconnected.set()
        return websocket


async def _collect_events(stream: DeepgramWordStream):
    return [event async for event in stream]


@pytest.mark.asyncio
async def test_stream_reconnects_after_established_websocket_disconnect(monkeypatch) -> None:
    first = _FakeWebSocket(disconnect_after_first_audio=True)
    second = _FakeWebSocket()
    session = _FakeClientSession([first, second])
    monkeypatch.setattr(
        "grouptalk_livekit_worker.deepgram.aiohttp.ClientSession",
        lambda **_kwargs: session,
    )
    stream = DeepgramWordStream(api_key="secret", retry_delays=(0.0, 0.0))
    consume_task = asyncio.create_task(_collect_events(stream))

    await stream.push_frame(
        SimpleNamespace(data=memoryview(b"first"), sample_rate=16_000, samples_per_channel=320)
    )
    await asyncio.wait_for(session.reconnected.wait(), timeout=1)
    await stream.push_frame(
        SimpleNamespace(data=memoryview(b"second"), sample_rate=16_000, samples_per_channel=320)
    )
    await asyncio.wait_for(second.audio_sent.wait(), timeout=1)
    await stream.end_input()

    events = await asyncio.wait_for(consume_task, timeout=1)

    assert session.connect_count == 2
    assert first.sent_audio == [b"first"]
    assert second.sent_audio == [b"second"]
    assert [(event.speaker_id, event.text) for event in events] == [
        ("S0", "첫째 발화"),
        ("S1", "둘째 발화."),
    ]
    assert events[0].start_time == pytest.approx(0.12)
