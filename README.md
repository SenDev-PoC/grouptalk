# 모둠뷰

교실 모둠 활동에서 각 모둠이 공용 기기 한 대로 입장해 대화하면, 교사가 모둠별 참여 균형과 대화 흐름을 실시간으로 확인하는 웹앱입니다.

> 참여 상태는 교사가 **지금 어느 모둠을 먼저 살펴볼지** 찾도록 돕는 수업 지원 신호이며, 학생 개인을 평가하는 점수가 아닙니다. 기획 배경은 [`docs/planning/`](docs/planning/)에 있습니다.

## 주요 흐름

- **교사** — 학급·학생 명단과 모둠 편성 관리 → 활동 만들기 → QR 공유 → 활동 시작 → 실시간 참여 대시보드 → 종료 → 사후 리포트·전사 다운로드
- **모둠** — QR/링크로 공용 기기 입장 → 모둠·구성원 확인 → 대기 → 마이크로 대화 → 참여 알림 확인 → 종료
- **분석** — 공용 마이크 음성을 익명 화자로 분리해 전사 → 발화 시간 기반 참여 균형 계산 → 대화 요약·키워드·주제 관련성 분석

원본 오디오와 중간 전사는 저장하지 않으며, 익명 화자를 학생 이름과 연결하지 않습니다.

## 기술 스택

- **프런트엔드** — React 19, TypeScript, Vite 8, React Router, Tailwind CSS 4, shadcn/ui, Supabase Realtime, LiveKit Client
- **백엔드** — Python 3.12/3.13, FastAPI, PostgreSQL, SQLAlchemy, LiveKit Agents, Deepgram, OpenAI Responses API
- **배포** — Vercel, Railway, Supabase

## 실행 모드

필요한 범위에 따라 세 단계로 실행할 수 있습니다.

| 모드 | 필요한 구성 | 확인할 수 있는 범위 |
|---|---|---|
| 브라우저 데모 | Node.js, npm | 교사·모둠 화면, 상태 전환, 합성 참여 상태 |
| Supabase 연결 | 데모 구성 + Supabase | 실제 데이터 저장, Realtime, 학급·명단·모둠 편성 |
| 전체 분석 | Supabase + FastAPI + LiveKit worker + 대화 분석 worker | 실제 음성 전사, 참여 분석, 요약·키워드·주제 관련성 |

처음 저장소를 실행한다면 먼저 데모 모드로 화면을 확인한 뒤 필요한 서비스를 하나씩 연결하는 것을 권장합니다.

## 빠른 시작: 데모 모드

Vite 8 실행을 위해 Node.js 22.12 이상을 권장합니다.

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`의 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`를 비워 두면 앱 전체가 브라우저 안의 데모 데이터로 동작합니다. 탭 사이 동기화는 `BroadcastChannel`을 사용하고, 화면 상단의 데모 배너가 합성 데이터임을 표시합니다.

- 교사 화면: <http://localhost:5173/teacher>
- 학생 입장 화면: 교사 화면에서 활동을 만든 뒤 표시되는 QR 또는 `/join/:joinCode`

같은 컴퓨터에서 교사 화면과 학생 화면을 서로 다른 탭으로 열면 실시간 상태 전환을 확인할 수 있습니다.

## Supabase 연결

### 1. 데이터베이스 적용

- **새 프로젝트** — [`supabase/schema.sql`](supabase/schema.sql)을 Supabase SQL Editor에서 실행합니다.
- **기존 프로젝트** — [`supabase/migrations/`](supabase/migrations/)에서 아직 적용하지 않은 파일을 타임스탬프 순서대로 적용합니다.

`schema.sql`은 새 설치용 현재 스냅샷이고, `migrations/`는 기존 DB를 업그레이드하는 변경 이력입니다.

### 2. 프런트엔드 환경 변수

루트 `.env.local`에 Supabase 프로젝트 값을 설정합니다.

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_LIVEKIT_TOKEN_ENDPOINT=http://localhost:8000/livekit/token
```

환경 변수의 전체 목록과 설명은 [`.env.example`](.env.example)에 있습니다. Supabase만 연결한 상태에서도 데이터 저장과 Realtime 흐름은 확인할 수 있지만, 실제 마이크 전사에는 아래의 전체 분석 구성이 필요합니다.

## 전체 분석 환경 구성

### 사전 준비

- Node.js 22.12 이상과 npm
- Python 3.12 또는 3.13과 [`uv`](https://docs.astral.sh/uv/)
- 스키마가 적용된 Supabase/PostgreSQL
- LiveKit 프로젝트와 API key/secret
- Deepgram API key
- 의미 분석을 실행할 경우 OpenAI API key

### 1. 환경 파일 준비

```bash
cp .env.example .env.local
cp backend/.env.example backend/.env
cp backend/livekit-worker/.env.example backend/livekit-worker/.env
```

각 파일에서 placeholder를 실제 값으로 바꿉니다.

- [프런트엔드 환경 변수](.env.example)
- [FastAPI·대화 분석 환경 변수](backend/.env.example)
- [LiveKit worker 환경 변수](backend/livekit-worker/.env.example)

`LIVEKIT_WORKER_AGENT_NAME`과 32자 이상의 `WORKER_API_TOKEN`은 FastAPI와 LiveKit worker에 같은 값으로 설정해야 합니다. 비밀값이 든 `.env` 파일은 커밋하지 않습니다.

### 2. 의존성 설치

```bash
npm install

cd backend
uv sync

cd livekit-worker
uv sync
```

### 3. 서비스 실행

아래 프로세스를 각각 별도 터미널에서 실행합니다.

```bash
# 터미널 1: 프런트엔드
npm run dev
```

```bash
# 터미널 2: FastAPI
cd backend
uv run uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
# 터미널 3: LiveKit → Deepgram 전사 worker
cd backend/livekit-worker
uv run python -m grouptalk_livekit_worker.agent dev
```

```bash
# 터미널 4: OpenAI 대화 의미 분석 worker
cd backend
uv run python -m api.conversation_analysis.main
```

FastAPI와 LiveKit worker는 다음 명령으로 함께 실행할 수도 있습니다. 이 스크립트에는 대화 의미 분석 worker가 포함되지 않습니다.

```bash
cd backend
bash scripts/dev-stack.sh
```

FastAPI 상태는 다음 엔드포인트에서 확인합니다.

```bash
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
```

각 백엔드의 세부 설정과 장애 확인 방법은 [Backend README](backend/README.md)와 [LiveKit worker README](backend/livekit-worker/README.md)를 참고합니다.

## 처리 구조

```text
교사·모둠 브라우저 ── 애플리케이션 데이터 ──> Supabase/PostgreSQL
        │                                      ▲
        └─ 마이크 ─> LiveKit ─> Deepgram worker ─> FastAPI
                                              │
                         발화·참여 분석 ────────┘
                                              │
                    대화 분석 worker ─> OpenAI ─> 요약·키워드·주제 관련성
```

FastAPI가 `utterances`와 `group_insights`의 쓰기를 소유합니다. 프런트엔드는 두 테이블을 읽고, 활동·세션·모둠·명단 등 사용자 조작 데이터는 Supabase Data API를 통해 기록합니다. 상세 계약은 [`docs/backend-contract.md`](docs/backend-contract.md)에 있습니다.

## 휴대폰에서 로컬 서버 접속

휴대폰에서 개발 PC의 Vite 서버에 접속할 때 `localhost`는 휴대폰 자신을 가리킵니다.

1. Vite를 LAN에 공개합니다.

   ```bash
   npm run dev -- --host 0.0.0.0
   ```

2. 루트 `.env.local`의 토큰 엔드포인트를 개발 PC의 LAN IP로 바꿉니다.

   ```dotenv
   VITE_LIVEKIT_TOKEN_ENDPOINT=http://<개발-PC-LAN-IP>:8000/livekit/token
   ```

3. `backend/.env`의 `CORS_ORIGINS`에 휴대폰이 여는 Vite origin을 추가합니다.

   ```dotenv
   CORS_ORIGINS=["http://localhost:5173","http://<개발-PC-LAN-IP>:5173"]
   ```

## 주요 라우트

| 경로 | 화면 |
|---|---|
| `/` | `/teacher`로 이동 |
| `/teacher` | 교사 홈: 내 활동, 활동 기록, 모둠 편성 |
| `/teacher/group-form` | 학급·명단·조건 기반 모둠 편성 |
| `/teacher/activity/:activityId` | 대기실 또는 실시간 대시보드 |
| `/teacher/activity/:activityId/report` | 종료된 활동의 사후 리포트 |
| `/join/:joinCode` | 모둠 기기 입장 |
| `/student/:activityId` | 대기·활동·종료 상태가 전환되는 모둠 화면 |
| `*` | 404 |

경로의 `:activityId`는 활동 템플릿이 아니라 **활동 세션**의 ID입니다.

## 참여 상태 원칙

판정 규칙은 [`src/lib/group-status.ts`](src/lib/group-status.ts)에 모여 있습니다.

- 연결·최신성 문제가 있으면 참여 경향 판단을 유보합니다.
- 분석이 45초 이상 갱신되지 않으면 지난 경향 대신 「갱신 중단」을 표시합니다.
- 기기 하트비트가 20초 이상 끊기면 「연결 실패」로 봅니다.
- 정보가 부족하면 정상·편중을 단정하지 않습니다.

## 검증

### 프런트엔드

```bash
npm run typecheck
npm run lint
npm run build
npm run check:status
npm run check:heartbeat
npm run check:mic-activity
npm run check:security
npm run check:session-refresh
```

`check:security`는 로컬 Supabase와 `psql`을 사용해 익명 클라이언트의 서버 소유 테이블 쓰기가 차단되고 읽기·Realtime은 유지되는지 확인합니다. 원격 프로젝트를 대상으로는 실행되지 않습니다.

### FastAPI와 대화 분석

```bash
cd backend
uv run pytest
uv run ruff check api tests
uv run ruff format --check api tests
```

실제 PostgreSQL migration까지 검증하려면 테스트 DB를 가리키는 `TEST_DATABASE_URL`과 `REQUIRE_POSTGRES_TESTS=1`을 설정합니다. 테스트 전용 DB만 사용하세요.

### LiveKit worker

```bash
cd backend/livekit-worker
uv run pytest
uv run ruff check src tests
uv run ruff format --check src tests
```

자동 테스트는 실제 LiveKit·Deepgram 성공을 대신하지 않습니다. 실제 음성 smoke 절차와 개인정보 취급 원칙은 [LiveKit worker README](backend/livekit-worker/README.md#실제-deepgram-smoke)에 있습니다.

## 배포

- **프런트엔드** — Vercel. SPA rewrite는 [`vercel.json`](vercel.json)에 있습니다.
- **FastAPI** — Railway `/backend` 서비스
- **LiveKit worker** — Railway `/backend/livekit-worker` 서비스
- **대화 분석 worker** — Railway `/backend`의 별도 서비스

배포 순서는 **DB migration → FastAPI → LiveKit worker → 대화 분석 worker**입니다. Railway root directory, healthcheck, watch path와 필수 변수는 [Backend README](backend/README.md#railway)에 정리돼 있습니다.

```bash
npm run build
```

## 문서 안내

- [제품 기획과 사용자 흐름](docs/planning/)
- [백엔드 전체 계약](docs/backend-contract.md)
- [FastAPI·대화 분석 개발 및 배포](backend/README.md)
- [LiveKit·Deepgram worker 개발 및 배포](backend/livekit-worker/README.md)
