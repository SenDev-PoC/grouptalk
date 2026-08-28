import logging
from typing import Protocol

from .models import AnalysisWindow, ConversationAnalysisResult
from .repository import ConversationAnalysisRepository

logger = logging.getLogger(__name__)
MIN_FINALS = 3
RETRY_DELAYS_SECONDS = (15, 30, 60)


class ConversationAnalyzer(Protocol):
    async def analyze(self, window: AnalysisWindow) -> ConversationAnalysisResult: ...


class ConversationAnalysisRunner:
    def __init__(
        self,
        *,
        repository: ConversationAnalysisRepository,
        analyzer: ConversationAnalyzer,
    ) -> None:
        self._repository = repository
        self._analyzer = analyzer

    async def run_once(self) -> None:
        for candidate in await self._repository.list_candidates():
            window = await self._repository.load_window(candidate)
            if window is None:
                continue
            same_window = candidate.last_attempted_utterance_id == window.latest_utterance_id
            if same_window and (candidate.analysis_status != "failed" or not candidate.retry_due):
                continue
            if len(window.utterances) < MIN_FINALS:
                await self._repository.mark_insufficient(window)
                continue
            try:
                result = await self._analyzer.analyze(window)
            except Exception as error:
                error_code = getattr(error, "code", "unexpected_provider_error")
                retryable = bool(getattr(error, "retryable", True))
                retry_count = candidate.retry_count + 1 if same_window else 1
                retry_delay_seconds = (
                    RETRY_DELAYS_SECONDS[retry_count - 1]
                    if retryable and retry_count <= len(RETRY_DELAYS_SECONDS)
                    else None
                )
                logger.exception(
                    "conversation_analysis_failed",
                    extra={
                        "event_code": "conversation_analysis_failed",
                        "error_code": error_code,
                        "retry_count": retry_count,
                        "retry_scheduled": retry_delay_seconds is not None,
                    },
                )
                await self._repository.mark_failed(
                    window,
                    error_code=error_code,
                    retry_count=retry_count,
                    retry_delay_seconds=retry_delay_seconds,
                )
                continue
            await self._repository.complete(window, result)
