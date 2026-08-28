from collections.abc import Iterator

import httpx
import pytest

from grouptalk_livekit_worker.api_client import (
    PermanentAPIError,
    RetryExhaustedError,
    SessionEndedError,
    UtteranceAPIClient,
)

TOKEN = "worker-test-token-with-at-least-32-characters"
PAYLOAD = {
    "source_event_id": "stable-event-id",
    "session_id": "11111111-1111-4111-8111-111111111111",
    "group_id": "22222222-2222-4222-8222-222222222222",
    "speaker_label": "화자 A",
    "text": "민감한 전사문",
    "spoken_at": "2026-08-29T01:02:03Z",
}


class FakeResponse:
    def __init__(self, status_code: int, body: dict[str, object] | None = None) -> None:
        self.status_code = status_code
        self._body = body or {}

    def json(self) -> dict[str, object]:
        return self._body


class FakeHTTPClient:
    def __init__(self, outcomes: Iterator[FakeResponse | Exception]) -> None:
        self.outcomes = outcomes
        self.calls: list[dict[str, object]] = []

    async def post(self, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        outcome = next(self.outcomes)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.mark.asyncio
async def test_retries_transient_failures_with_the_same_payload_and_bounded_delays() -> None:
    request = httpx.Request("POST", "https://api.example.com")
    http = FakeHTTPClient(
        iter(
            [
                httpx.ConnectError("network detail", request=request),
                FakeResponse(503),
                FakeResponse(201, {"status": "stored"}),
            ]
        )
    )
    delays: list[float] = []
    client = UtteranceAPIClient(
        base_url="https://api.example.com",
        token=TOKEN,
        http_client=http,
        max_attempts=3,
        retry_delays=(0.5, 1.0),
        sleep=delays.append,
    )

    await client.send(PAYLOAD)

    assert delays == [0.5, 1.0]
    assert [call["json"] for call in http.calls] == [PAYLOAD, PAYLOAD, PAYLOAD]
    assert all(call["headers"] == {"Authorization": f"Bearer {TOKEN}"} for call in http.calls)


@pytest.mark.asyncio
async def test_exhausted_5xx_raises_without_changing_the_event_id() -> None:
    http = FakeHTTPClient(iter([FakeResponse(500), FakeResponse(502), FakeResponse(503)]))
    client = UtteranceAPIClient(
        base_url="https://api.example.com",
        token=TOKEN,
        http_client=http,
        max_attempts=3,
        retry_delays=(0.0, 0.0),
        sleep=lambda _: None,
    )

    with pytest.raises(RetryExhaustedError):
        await client.send(PAYLOAD)

    assert {call["json"]["source_event_id"] for call in http.calls} == {"stable-event-id"}


@pytest.mark.asyncio
async def test_classifies_terminal_and_permanent_responses() -> None:
    ended = UtteranceAPIClient(
        base_url="https://api.example.com",
        token=TOKEN,
        http_client=FakeHTTPClient(
            iter([FakeResponse(409, {"detail": {"code": "session_not_active"}})])
        ),
    )
    conflict = UtteranceAPIClient(
        base_url="https://api.example.com",
        token=TOKEN,
        http_client=FakeHTTPClient(
            iter([FakeResponse(409, {"detail": {"code": "source_event_conflict"}})])
        ),
    )

    with pytest.raises(SessionEndedError):
        await ended.send(PAYLOAD)
    with pytest.raises(PermanentAPIError):
        await conflict.send(PAYLOAD)
