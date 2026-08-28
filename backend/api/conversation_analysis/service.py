import logging
from typing import Protocol

from .models import AnalysisWindow, ConversationAnalysisResult
from .repository import ConversationAnalysisRepository

logger = logging.getLogger(__name__)
MIN_FINALS = 3


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
            if (
                window is None
                or candidate.last_attempted_utterance_id == window.latest_utterance_id
            ):
                continue
            if len(window.utterances) < MIN_FINALS:
                await self._repository.mark_insufficient(window)
                continue
            try:
                result = await self._analyzer.analyze(window)
            except Exception:
                logger.exception(
                    "conversation_analysis_failed",
                    extra={"event_code": "conversation_analysis_failed"},
                )
                await self._repository.mark_failed(window)
                continue
            await self._repository.complete(window, result)
