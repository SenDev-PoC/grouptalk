import asyncio
import inspect
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)


class APIClientError(RuntimeError):
    pass


class RetryExhaustedError(APIClientError):
    pass


class PermanentAPIError(APIClientError):
    pass


class SessionEndedError(APIClientError):
    pass


class ResponseLike(Protocol):
    status_code: int

    def json(self) -> object: ...


class HTTPClientLike(Protocol):
    async def post(self, url: str, **kwargs: object) -> ResponseLike: ...


class UtteranceAPIClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        http_client: HTTPClientLike,
        max_attempts: int = 3,
        retry_delays: Sequence[float] = (0.5, 1.0),
        sleep: Callable[[float], Awaitable[None] | None] = asyncio.sleep,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be positive")
        if len(retry_delays) < max_attempts - 1:
            raise ValueError("retry_delays must cover every retry")
        self._url = f"{base_url.rstrip('/')}/internal/worker/utterances"
        self._headers = {"Authorization": f"Bearer {token}"}
        self._http_client = http_client
        self._max_attempts = max_attempts
        self._retry_delays = tuple(retry_delays)
        self._sleep = sleep

    async def send(self, payload: Mapping[str, object]) -> None:
        for attempt in range(1, self._max_attempts + 1):
            try:
                response = await self._http_client.post(
                    self._url,
                    json=payload,
                    headers=self._headers,
                )
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt == self._max_attempts:
                    raise RetryExhaustedError("worker API network retries exhausted") from None
                await self._wait_before_retry(attempt)
                continue

            if response.status_code in {200, 201}:
                logger.info(
                    "worker_api_utterance_accepted",
                    extra={
                        "event_code": "worker_api_utterance_accepted",
                        "response_status": response.status_code,
                    },
                )
                return
            if response.status_code >= 500:
                if attempt == self._max_attempts:
                    raise RetryExhaustedError("worker API server retries exhausted")
                await self._wait_before_retry(attempt)
                continue

            error_code = self._error_code(response)
            if response.status_code == 409 and error_code == "session_not_active":
                raise SessionEndedError("session is no longer active")
            raise PermanentAPIError(
                f"worker API rejected the event with status {response.status_code}"
            )

        raise RetryExhaustedError("worker API retries exhausted")

    async def _wait_before_retry(self, attempt: int) -> None:
        logger.warning(
            "worker_api_retry", extra={"event_code": "worker_api_retry", "attempt": attempt}
        )
        result = self._sleep(self._retry_delays[attempt - 1])
        if inspect.isawaitable(result):
            await result

    @staticmethod
    def _error_code(response: ResponseLike) -> str | None:
        try:
            body = response.json()
        except (TypeError, ValueError):
            return None
        if not isinstance(body, dict):
            return None
        detail = body.get("detail")
        if not isinstance(detail, dict):
            return None
        code = detail.get("code")
        return code if isinstance(code, str) else None
