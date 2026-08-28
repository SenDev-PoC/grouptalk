# Backend

FastAPI를 중심으로 관리하는 해커톤용 backend workspace다.

```text
backend/
├── pyproject.toml
├── uv.lock
├── api/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   └── health.py
└── tests/
```

API와 공통 개발 설정은 `backend/`에 둔다. 여러 서비스가 실제로 공유하는 Python 계약이 생기면 `backend/` 최상위에 모듈로 추가한다.

LiveKit worker는 별도 구현 및 커밋으로 관리하며, 현재 Railway 배포 대상에는 포함하지 않는다.

## 로컬 실행

```bash
cd backend
uv sync
cp .env.example .env
uv run uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

## 검증

```bash
uv run pytest
uv run ruff check api tests
uv run ruff format --check api tests
```

## Railway

현재 Railway에는 FastAPI만 배포한다. 저장소를 연결한 API 서비스에서 다음 값을 설정한다.

- Root Directory: `/backend`
- Healthcheck Path: `/health/live`
- Watch Paths: `/backend/api/**`, `/backend/pyproject.toml`, `/backend/uv.lock`,
  `/backend/railpack.json`
- Public Networking: 도메인 생성

`railpack.json`은 다음을 고정한다.

- Railpack이 `pyproject.toml`과 `uv.lock`으로 API 의존성을 설치한다.
- `uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}`로 FastAPI만 실행한다.
- `livekit-worker/`와 테스트는 API 배포 이미지에서 제외한다.
- `/health/live`가 HTTP 200을 반환해야 새 배포가 활성화된다. 이 값은 Railway
  서비스 설정에서 지정한다.
- 프론트엔드와 `livekit-worker/`만 변경된 커밋은 API를 다시 배포하지 않는다.

Railway Variables에는 `.env.example`을 기준으로 실제 값을 등록한다. 최소 운영값은
`APP_ENV=production`, `DATABASE_URL`, `CORS_ORIGINS`, `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`이다. 비밀값이 든 `.env` 파일은 배포하거나
커밋하지 않는다.
