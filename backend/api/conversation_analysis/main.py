import asyncio
import logging
import signal

from api.config import get_settings
from api.database import Database

from .provider import OpenAIConversationAnalyzer
from .repository import ConversationAnalysisRepository
from .service import ConversationAnalysisRunner

logger = logging.getLogger(__name__)


async def run() -> None:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required")
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is required")

    database = Database(settings.database_url)
    runner = ConversationAnalysisRunner(
        repository=ConversationAnalysisRepository(database.session_factory),
        analyzer=OpenAIConversationAnalyzer(
            api_key=settings.openai_api_key,
            model=settings.conversation_analysis_model,
        ),
    )
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)

    logger.info("conversation_analysis_worker_started")
    try:
        while not stop.is_set():
            await runner.run_once()
            try:
                await asyncio.wait_for(
                    stop.wait(),
                    timeout=settings.conversation_analysis_poll_seconds,
                )
            except TimeoutError:
                pass
    finally:
        await database.dispose()
        logger.info("conversation_analysis_worker_stopped")


if __name__ == "__main__":
    asyncio.run(run())
