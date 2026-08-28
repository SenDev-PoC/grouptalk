from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "GroupTalk API"
    app_env: str = "local"
    debug: bool = False
    database_url: str | None = Field(default=None, repr=False)
    database_ping_timeout_seconds: float = Field(default=3.0, gt=0, le=30)
    cors_origins: list[str] = Field(default_factory=list)
    livekit_url: str | None = None
    livekit_api_key: str | None = Field(default=None, repr=False)
    livekit_api_secret: str | None = Field(default=None, repr=False)
    livekit_worker_agent_name: str = "grouptalk-transcriber"
    worker_api_token: str | None = Field(default=None, repr=False)
    openai_api_key: str | None = Field(default=None, repr=False)
    conversation_analysis_model: str = "gpt-5.6-luna"
    conversation_analysis_poll_seconds: float = Field(default=5, gt=0, le=60)
    conversation_analysis_max_output_tokens: int = Field(default=1200, ge=900, le=4000)


@lru_cache
def get_settings() -> Settings:
    return Settings()
