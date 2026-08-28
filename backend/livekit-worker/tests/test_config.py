import pytest
from pydantic import ValidationError

from grouptalk_livekit_worker.config import WorkerSettings

TOKEN = "worker-test-token-with-at-least-32-characters"
LIVEKIT_API_KEY = "livekit-test-key"
LIVEKIT_API_SECRET = "livekit-test-secret"


def _settings(api_url: str) -> WorkerSettings:
    return WorkerSettings(
        _env_file=None,
        livekit_url="wss://test.livekit.cloud",
        livekit_api_key=LIVEKIT_API_KEY,
        livekit_api_secret=LIVEKIT_API_SECRET,
        grouptalk_api_url=api_url,
        worker_api_token=TOKEN,
        deepgram_api_key="deepgram-test-key",
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://api.example.com",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://[::1]:8000",
        "http://api.railway.internal:8000",
    ],
)
def test_accepts_secure_or_private_api_origins(url: str) -> None:
    assert _settings(url).grouptalk_api_url == url.rstrip("/")


@pytest.mark.parametrize(
    "url",
    [
        "http://api.example.com",
        "https://user:pass@api.example.com",
        "https://api.example.com/path",
        "https://api.example.com?query=yes",
        "https://api.example.com#fragment",
    ],
)
def test_rejects_public_http_and_non_origin_urls(url: str) -> None:
    with pytest.raises(ValidationError):
        _settings(url)


def test_secrets_are_not_in_settings_repr() -> None:
    settings = _settings("https://api.example.com")

    assert TOKEN not in repr(settings)
    assert "deepgram-test-key" not in repr(settings)
    assert LIVEKIT_API_KEY not in repr(settings)
    assert LIVEKIT_API_SECRET not in repr(settings)


def test_reads_required_credentials_from_dotenv(tmp_path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "LIVEKIT_URL=wss://dotenv.livekit.cloud",
                "LIVEKIT_API_KEY=dotenv-livekit-key",
                "LIVEKIT_API_SECRET=dotenv-livekit-secret",
                "GROUPTALK_API_URL=https://api.example.com",
                f"WORKER_API_TOKEN={TOKEN}",
                "DEEPGRAM_API_KEY=dotenv-deepgram-key",
            ]
        ),
        encoding="utf-8",
    )

    settings = WorkerSettings(_env_file=env_file)

    assert settings.livekit_url == "wss://dotenv.livekit.cloud"
    assert settings.livekit_api_key.get_secret_value() == "dotenv-livekit-key"
    assert settings.livekit_api_secret.get_secret_value() == "dotenv-livekit-secret"


def test_rejects_retry_counts_beyond_the_bounded_backoff_contract() -> None:
    with pytest.raises(ValidationError):
        WorkerSettings(
            _env_file=None,
            livekit_url="wss://test.livekit.cloud",
            livekit_api_key=LIVEKIT_API_KEY,
            livekit_api_secret=LIVEKIT_API_SECRET,
            grouptalk_api_url="https://api.example.com",
            worker_api_token=TOKEN,
            deepgram_api_key="deepgram-test-key",
            api_max_attempts=4,
        )
