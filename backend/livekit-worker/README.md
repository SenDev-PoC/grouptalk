# LiveKit Worker

모둠 전체가 공용 기기 한 대로 참여하는 활동의 microphone track을 받는 독립 worker다.
세션 room에는 모둠마다 participant 하나가 있고, worker는 각 track을 별도 Deepgram
stream으로 보내 한 공용 microphone 안의 화자를 익명 `화자 A/B/...`로 구분한다.

처리 경로는 다음에서 끝난다.

```text
LiveKit microphone → Deepgram nova-3(ko, diarization) → final-only 정규화
  → 인증된 FastAPI /internal/worker/utterances → PostgreSQL utterances
```

원본 audio와 interim transcript는 저장하지 않는다. 학생 이름과 익명 화자를 연결하지
않으며, LLM과 `group_insights` 갱신은 다음 구현 단위다. worker는 Supabase에 직접
접근하지 않는다.

## 로컬 실행

```bash
cd backend/livekit-worker
uv sync
cp .env.example .env
uv run python -m grouptalk_livekit_worker.agent dev
```

FastAPI도 별도 terminal에서 먼저 실행해야 한다. `GROUPTALK_API_URL`은 HTTPS origin을
기본으로 하며 로컬 loopback과 `*.railway.internal`에서만 HTTP를 허용한다.
`WORKER_API_TOKEN`은 32자 이상의 무작위 값으로 만들고 API와 worker에 같은 값을
설정한다.

## 검증

```bash
uv run pytest
uv run ruff check src tests
uv run ruff format --check src tests
```

fake 테스트는 G/H 두 모둠의 interim/final, 화자 순서, API 재시도, 한 모둠의 Deepgram
장애를 재현한다. fake 결과를 실제 Deepgram 성공으로 간주하지 않는다.

## Railway worker 서비스

- Root Directory: `/backend/livekit-worker`
- Start Command: `uv run python -m grouptalk_livekit_worker.agent start`
- Healthcheck Path: `/`
- 기본 health port: `8081` (`PORT`로 변경 가능)
- Private Networking: API 서비스의 `*.railway.internal` origin 사용

필수 변수는 `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`LIVEKIT_WORKER_AGENT_NAME`, `DEEPGRAM_API_KEY`, `GROUPTALK_API_URL`,
`WORKER_API_TOKEN`이다. API와 worker의 agent name과 worker token은 반드시 같아야 한다.

배포 순서는 다음과 같다.

1. `20260829000000_live_utterances.sql` migration 적용
2. FastAPI 배포와 `/health/ready` 확인
3. worker 배포와 `/` health 확인
4. 이미 만들어진 room이 아닌 새 session에서 smoke

token의 named dispatch는 room 생성 때 적용되므로 worker 배포 전에 만들어진 room은
smoke 대상으로 재사용하지 않는다.

## 실제 Deepgram smoke

자동 테스트가 모두 통과한 뒤 실제 학생이 아닌 동의한 성인 두 명이 공용 기기 앞에서
겹치지 않게 한국어 문장을 번갈아 말한다. DB에서 live final 2행 이상과 익명 표지 2개
이상, event ID uniqueness를 확인한다. transcript 원문·identity·secret·audio를 검증
기록에 복사하지 않는다. 두 화자가 분리되지 않으면 smoke는 실패이며 provider word-level
분할을 다음 설계로 검토한다.
