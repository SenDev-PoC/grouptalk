from ipaddress import ip_address
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    livekit_url: str
    livekit_api_key: SecretStr = Field(repr=False, min_length=1)
    livekit_api_secret: SecretStr = Field(repr=False, min_length=1)
    grouptalk_api_url: str
    worker_api_token: SecretStr = Field(repr=False, min_length=32)
    deepgram_api_key: SecretStr = Field(repr=False, min_length=1)
    livekit_worker_agent_name: str = Field(default="grouptalk-transcriber", min_length=1)
    transcript_queue_capacity: int = Field(default=64, gt=0)
    api_request_timeout_seconds: float = Field(default=5.0, gt=0)
    api_max_attempts: int = Field(default=3, ge=1, le=3)
    pipeline_shutdown_timeout_seconds: float = Field(default=10.0, gt=0)
    port: int = Field(default=8081, ge=1, le=65535)

    @field_validator("livekit_url")
    @classmethod
    def validate_livekit_origin(cls, value: str) -> str:
        parsed = urlsplit(value.strip())
        if parsed.scheme not in {"ws", "wss"} or not parsed.hostname:
            raise ValueError("LIVEKIT_URL must be a WebSocket origin")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("LIVEKIT_URL must not contain user information")
        if parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("LIVEKIT_URL must not contain path, query, or fragment")
        try:
            parsed_port = parsed.port
        except ValueError as error:
            raise ValueError("LIVEKIT_URL has an invalid port") from error
        if parsed_port is not None and not 1 <= parsed_port <= 65535:
            raise ValueError("LIVEKIT_URL has an invalid port")
        if parsed.scheme == "ws" and not cls._private_http_host(parsed.hostname):
            raise ValueError("LIVEKIT_URL requires WSS outside a private development network")
        return value.strip().rstrip("/")

    @field_validator("grouptalk_api_url")
    @classmethod
    def validate_api_origin(cls, value: str) -> str:
        parsed = urlsplit(value.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("GROUPTALK_API_URL must be an HTTP(S) origin")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("GROUPTALK_API_URL must not contain user information")
        if parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("GROUPTALK_API_URL must not contain path, query, or fragment")
        try:
            parsed_port = parsed.port
        except ValueError as error:
            raise ValueError("GROUPTALK_API_URL has an invalid port") from error
        if parsed_port is not None and not 1 <= parsed_port <= 65535:
            raise ValueError("GROUPTALK_API_URL has an invalid port")

        if parsed.scheme == "http" and not cls._private_http_host(parsed.hostname):
            raise ValueError(
                "GROUPTALK_API_URL requires HTTPS outside a private development network"
            )
        return value.strip().rstrip("/")

    @staticmethod
    def _private_http_host(hostname: str) -> bool:
        normalized = hostname.rstrip(".").casefold()
        if normalized == "localhost" or normalized.endswith(".railway.internal"):
            return True
        try:
            return ip_address(normalized).is_loopback
        except ValueError:
            return False
