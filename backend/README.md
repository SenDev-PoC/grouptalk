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

LiveKit worker는 별도 구현 및 커밋으로 관리한다.

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

- API Root Directory `backend`: `uv run uvicorn api.main:app --host 0.0.0.0 --port $PORT`
