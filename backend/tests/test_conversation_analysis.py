import json
from datetime import UTC, datetime
from uuid import UUID

import httpx
import pytest

from api.conversation_analysis.models import (
    AnalysisUtterance,
    AnalysisWindow,
    ConversationAnalysisResult,
)
from api.conversation_analysis.provider import OpenAIConversationAnalyzer
from api.conversation_analysis.repository import AnalysisCandidate, ConversationAnalysisRepository
from api.conversation_analysis.service import ConversationAnalysisRunner

SESSION_ID = UUID("11111111-1111-4111-8111-111111111111")
GROUP_ID = UUID("22222222-2222-4222-8222-222222222222")
UTTERANCE_IDS = tuple(UUID(int=index) for index in range(1, 5))
NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


def _window(count: int = 3) -> AnalysisWindow:
    return AnalysisWindow(
        session_id=SESSION_ID,
        group_id=GROUP_ID,
        topic="지역 환경 문제 해결",
        utterances=tuple(
            AnalysisUtterance(
                id=UTTERANCE_IDS[index],
                speaker_label=f"화자 {chr(ord('A') + index % 2)}",
                text=f"의견 {index + 1}",
                spoken_at=NOW,
            )
            for index in range(count)
        ),
    )


class FakeResponse:
    def __init__(self, result: dict[str, object], *, status_code: int = 200) -> None:
        self.status_code = status_code
        self._body = {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(result)}],
                }
            ]
        }
        self.request = httpx.Request("POST", "https://api.openai.com/v1/responses")

    def json(self) -> dict[str, object]:
        return self._body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("provider failed", request=self.request, response=self)


class FakeHTTPClient:
    def __init__(self, result: dict[str, object]) -> None:
        self.response = FakeResponse(result)
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def post(self, url: str, **kwargs: object) -> FakeResponse:
        self.calls.append((url, kwargs))
        return self.response


def _analysis_result(**overrides: object) -> dict[str, object]:
    result: dict[str, object] = {
        "topic_relevance": "mixed",
        "off_topic_reason": "chitchat",
        "off_topic_utterance_ids": [str(UTTERANCE_IDS[1])],
        "summary": "환경 문제의 원인과 해결 방법을 논의했습니다.",
        "keywords": ["환경", "해결 방법"],
        "confidence": 0.84,
    }
    result.update(overrides)
    return result


@pytest.mark.asyncio
async def test_openai_provider_uses_stateless_structured_output() -> None:
    http_client = FakeHTTPClient(_analysis_result())
    analyzer = OpenAIConversationAnalyzer(
        api_key="test-api-key",
        model="test-model",
        http_client=http_client,
    )

    result = await analyzer.analyze(_window())

    assert result.topic_relevance == "mixed"
    assert result.off_topic_utterance_ids == [UTTERANCE_IDS[1]]
    _, kwargs = http_client.calls[0]
    payload = kwargs["json"]
    assert isinstance(payload, dict)
    assert payload["store"] is False
    assert payload["text"]["format"]["type"] == "json_schema"
    assert payload["text"]["format"]["strict"] is True
    assert "실제 이름" not in str(payload)


@pytest.mark.asyncio
async def test_openai_provider_rejects_evidence_outside_window() -> None:
    http_client = FakeHTTPClient(
        _analysis_result(off_topic_utterance_ids=["ffffffff-ffff-4fff-8fff-ffffffffffff"])
    )
    analyzer = OpenAIConversationAnalyzer(
        api_key="test-api-key",
        model="test-model",
        http_client=http_client,
    )

    with pytest.raises(ValueError, match="source window"):
        await analyzer.analyze(_window())


class FakeRepository:
    def __init__(
        self,
        window: AnalysisWindow,
        *,
        last_attempted_utterance_id: UUID | None = None,
    ) -> None:
        self.window = window
        self.last_attempted_utterance_id = last_attempted_utterance_id
        self.completed: ConversationAnalysisResult | None = None
        self.insufficient = False
        self.failed = False

    async def list_candidates(self) -> tuple[AnalysisCandidate, ...]:
        return (
            AnalysisCandidate(
                session_id=SESSION_ID,
                group_id=GROUP_ID,
                topic=self.window.topic,
                last_attempted_utterance_id=self.last_attempted_utterance_id,
            ),
        )

    async def load_window(self, candidate: AnalysisCandidate) -> AnalysisWindow:
        return self.window

    async def mark_insufficient(self, window: AnalysisWindow) -> None:
        self.insufficient = True

    async def mark_failed(self, window: AnalysisWindow) -> None:
        self.failed = True

    async def complete(
        self,
        window: AnalysisWindow,
        result: ConversationAnalysisResult,
    ) -> None:
        self.completed = result


class FakeAnalyzer:
    def __init__(self, *, fails: bool = False) -> None:
        self.fails = fails
        self.calls = 0

    async def analyze(self, window: AnalysisWindow) -> ConversationAnalysisResult:
        self.calls += 1
        if self.fails:
            raise RuntimeError("provider unavailable")
        return ConversationAnalysisResult.model_validate(_analysis_result())


@pytest.mark.asyncio
async def test_runner_completes_sufficient_window() -> None:
    repository = FakeRepository(_window())
    analyzer = FakeAnalyzer()

    await ConversationAnalysisRunner(repository=repository, analyzer=analyzer).run_once()

    assert analyzer.calls == 1
    assert repository.completed is not None
    assert repository.failed is False


@pytest.mark.asyncio
async def test_runner_skips_provider_for_insufficient_window() -> None:
    repository = FakeRepository(_window(2))
    analyzer = FakeAnalyzer()

    await ConversationAnalysisRunner(repository=repository, analyzer=analyzer).run_once()

    assert analyzer.calls == 0
    assert repository.insufficient is True


@pytest.mark.asyncio
async def test_runner_records_failure_without_raising() -> None:
    repository = FakeRepository(_window())
    analyzer = FakeAnalyzer(fails=True)

    await ConversationAnalysisRunner(repository=repository, analyzer=analyzer).run_once()

    assert analyzer.calls == 1
    assert repository.failed is True
    assert repository.completed is None


@pytest.mark.asyncio
async def test_runner_does_not_reanalyze_same_latest_utterance() -> None:
    window = _window()
    repository = FakeRepository(
        window,
        last_attempted_utterance_id=window.latest_utterance_id,
    )
    analyzer = FakeAnalyzer()

    await ConversationAnalysisRunner(repository=repository, analyzer=analyzer).run_once()

    assert analyzer.calls == 0


class CapturingRepository(ConversationAnalysisRepository):
    def __init__(self) -> None:
        self.extra: dict[str, object] | None = None

    async def _update(self, statement, *, window, extra=None) -> None:
        self.extra = extra


@pytest.mark.asyncio
async def test_repository_projects_evidence_quotes_from_source_window() -> None:
    repository = CapturingRepository()
    result = ConversationAnalysisResult.model_validate(_analysis_result())

    await repository.complete(_window(), result)

    assert repository.extra is not None
    evidence = json.loads(str(repository.extra["off_topic_evidence"]))
    assert evidence == [
        {
            "quote": "의견 2",
            "reason": "chitchat",
            "at": "2026-08-29T12:00:00Z",
        }
    ]
    assert repository.extra["off_topic_ratio"] == pytest.approx(1 / 3)
