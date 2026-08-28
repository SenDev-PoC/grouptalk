from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "ready"]
    database: Literal["configured", "not_configured"] | None = None


@router.get("/live", response_model=HealthResponse)
async def live() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/ready", response_model=HealthResponse)
async def ready(request: Request) -> HealthResponse:
    database_configured = request.app.state.database is not None
    settings = request.app.state.settings

    if settings.app_env != "local" and not database_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not configured",
        )

    return HealthResponse(
        status="ready",
        database="configured" if database_configured else "not_configured",
    )
