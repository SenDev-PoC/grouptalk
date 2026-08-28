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

LiveKit worker는 별도 Railway 서비스로 관리하며 API와 인증된 내부 전사 저장 계약을
공유한다.

## 로컬 실행

```bash
cd backend
uv sync
cp .env.example .env
uv run uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

API와 LiveKit worker를 함께 실행하려면 두 `.env`를 채운 뒤 다음 명령을 사용한다.

```bash
cd backend
bash scripts/dev-stack.sh
```

이 명령은 어느 한 서비스가 종료되면 다른 서비스도 함께 정리한다. 실제 전사 경로에는
로컬 Supabase, FastAPI, worker 세 구성 요소가 모두 필요하다.

휴대폰에서 개발 PC의 Vite 서버에 접속할 때 프런트의 `localhost`는 휴대폰 자신을
가리킨다. 루트 `.env.local`의 `VITE_LIVEKIT_TOKEN_ENDPOINT`를
`http://<개발-PC-LAN-IP>:8000/livekit/token`으로 바꾸고, backend `CORS_ORIGINS`에도
`http://<개발-PC-LAN-IP>:5173`을 추가한다. Vite는 `npm run dev -- --host 0.0.0.0`으로
실행한다.

## 검증

```bash
uv run pytest
uv run ruff check api tests
uv run ruff format --check api tests
```

## Railway

Railway의 FastAPI 서비스에서 다음 값을 설정한다.

- Root Directory: `/backend`
- Healthcheck Path: `/health/ready`
- Watch Paths: `/backend/api/**`, `/backend/pyproject.toml`, `/backend/uv.lock`,
  `/backend/railpack.json`
- Public Networking: 도메인 생성

`railpack.json`은 다음을 고정한다.

- Railpack이 `pyproject.toml`과 `uv.lock`으로 API 의존성을 설치한다.
- `uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}`로 FastAPI만 실행한다.
- `livekit-worker/`와 테스트는 API 배포 이미지에서 제외한다.
- `/health/ready`가 실제 PostgreSQL `select 1`을 제한 시간 안에 수행하고 HTTP 200을
  반환해야 새 배포가 활성화된다. 이 값은 Railway
  서비스 설정에서 지정한다.
- 프론트엔드와 `livekit-worker/`만 변경된 커밋은 API를 다시 배포하지 않는다.

Railway Variables에는 `.env.example`을 기준으로 실제 값을 등록한다. 최소 운영값은
`APP_ENV=production`, `DATABASE_URL`, `CORS_ORIGINS`, `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`이다. 비밀값이 든 `.env` 파일은 배포하거나
커밋하지 않는다.

LiveKit worker를 함께 배포할 때는 API와 worker에 같은
`LIVEKIT_WORKER_AGENT_NAME`(기본 `grouptalk-transcriber`)과 32자 이상의 무작위
`WORKER_API_TOKEN`을 설정한다. worker는 이 token으로만
`POST /internal/worker/utterances`를 호출하며 브라우저에는 노출하지 않는다.

worker 서비스는 Root Directory를 `/backend/livekit-worker`, Healthcheck Path를 `/`로
두고 해당 디렉터리의 `railpack.json`으로 실행한다. migration과 API를 먼저 배포한 뒤
worker를 배포하고 새 session을 만들어 확인한다.

## Worker 전사 저장 API

`POST /internal/worker/utterances`는 active session의 올바른 group에 Deepgram final
전사 한 건을 저장한다. `Authorization: Bearer <WORKER_API_TOKEN>`이 필수다. 같은
`session_id`/`group_id`/`source_event_id`를 같은 payload로 다시 보내면 기존 ID와
`duplicate`를 반환하고, payload가 다르면 `source_event_conflict`로 거부한다.

새 전사를 저장한 transaction은 같은 모둠의 최근 5분·최대 20건을
`participation-count-v1`으로 계산해 `group_insights`를 갱신한다. 같은 모둠 요청은
PostgreSQL advisory lock으로 직렬화하며 exact duplicate는 분석과 `updated_at`을
변경하지 않는다. 원본 음성·주제 관련성·요약·키워드는 이 경로에서 처리하지 않는다.

`20260829000000_live_utterances.sql` 뒤
`20260829130000_realtime_analysis_window.sql`을 적용한다. DB migration 검증은 기본
suite에서 정적 계약을 항상 확인한다. 실제 PostgreSQL 적용까지
확인하려면 전용 test database를 가리키는 `TEST_DATABASE_URL`과
`REQUIRE_POSTGRES_TESTS=1`을 설정해
`uv run pytest tests/test_utterance_schema.py tests/test_worker_utterances.py`를 실행한다.
test는 그 database 안의 임시 schema만 만들고 지운다.
