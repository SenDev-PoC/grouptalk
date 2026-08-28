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
    cors_origins: list[str] = Field(default_factory=list)
    livekit_url: str | None = None
    livekit_api_key: str | None = Field(default=None, repr=False)
    livekit_api_secret: str | None = Field(default=None, repr=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
