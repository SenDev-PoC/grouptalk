from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings
from api.database import Database
from api.health import router as health_router
from api.livekit_tokens import router as livekit_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    database = Database(settings.database_url) if settings.database_url else None

    app.state.settings = settings
    app.state.database = database

    try:
        yield
    finally:
        if database is not None:
            await database.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        debug=settings.debug,
        lifespan=lifespan,
    )
    if settings.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    application.include_router(health_router)
    application.include_router(livekit_router)

    @application.get("/", tags=["meta"])
    async def root() -> dict[str, str]:
        return {"service": "grouptalk-api", "docs": "/docs"}

    return application


app = create_app()
