# 모둠뷰

교실 모둠 활동에서 학생이 각자 기기로 입장해 대화하면, 교사가 모둠별 참여 균형을 실시간으로 확인하는 웹앱입니다.

> 참여 상태는 교사가 **지금 어느 모둠을 먼저 살펴볼지** 찾도록 돕는 수업 지원 신호이며, 학생 개인을 평가하는 점수가 아닙니다. 기획 배경은 [`planning/`](planning/)에 있습니다.

## 흐름

- **교사** — 활동 만들기 → QR로 학생 입장 → 활동 시작 → 실시간 참여 대시보드 → 종료 → 사후 리포트
- **학생** — QR/링크 입장(모둠·이름) → 대기 → 마이크 활동 → 종료 후 요약

## 기술 스택

React 19 · TypeScript · Vite · react-router-dom · Tailwind CSS 4 · shadcn/ui(new-york) · lucide-react · qrcode.react · Pretendard · Supabase(Realtime) · LiveKit · Vercel

## 시작하기

```bash
npm install
cp .env.example .env.local   # 값을 채우지 않아도 데모 데이터로 실행됩니다
npm run dev
```

휴대폰에서 개발 PC에 접속할 때는 `npm run dev -- --host 0.0.0.0`으로 실행하고,
`.env.local`의 `VITE_LIVEKIT_TOKEN_ENDPOINT`를
`http://<개발-PC-LAN-IP>:8000/livekit/token`으로 설정한다. 이때 backend의
`CORS_ORIGINS`에도 휴대폰이 여는 Vite origin을 추가해야 한다.

교사 화면은 데스크톱(`/teacher`), 학생 화면은 모바일(`/join/:joinCode`) 기준으로 만들어져 있습니다.
같은 컴퓨터에서 시연할 때는 교사 화면과 학생 화면을 다른 탭으로 열면 실시간 전환을 볼 수 있습니다.

### 데모 모드

`VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`가 비어 있으면 앱 전체가 브라우저 안의 데모 데이터로 동작합니다.
탭 사이 실시간 동기화는 `BroadcastChannel`로 처리하고, 참여 분석은 합성 상태를 만들어 고른 참여·편중 경향·정보 부족·연결 실패 네 가지를 모두 보여줍니다.
이때 화면 상단에 데모 배너가 떠서 무엇이 실제 분석이 아닌지 감추지 않습니다.

### Supabase 연결

1. [`supabase/schema.sql`](supabase/schema.sql)을 프로젝트의 SQL Editor에서 실행합니다.
2. `.env.local`에 프로젝트 URL과 anon key를 넣습니다.
3. 앱을 다시 실행하면 데모 배너가 사라지고 실제 테이블을 읽고 씁니다.

## 라우트

| 경로 | 화면 |
|---|---|
| `/` | `/teacher`로 replace |
| `/teacher` | 교사 홈 (내 활동 · 활동 기록 · 모둠 편성) |
| `/teacher/activity/:activityId` | 대기실 ↔ 실시간 대시보드 (종료된 세션은 리포트로 replace) |
| `/teacher/activity/:activityId/report` | 사후 리포트 |
| `/join/:joinCode` | 학생 입장 (모바일 우선) |
| `/student/:activityId` | 학생 룸 (waiting/active/ended 자동 전환) |
| `*` | 404 |

경로의 `:activityId`는 활동 템플릿이 아니라 **활동 세션**의 id입니다.

## 상태 모델

기획 문서의 사용자용 상태를 그대로 코드로 옮겼습니다. 판정 규칙은 [`src/lib/group-status.ts`](src/lib/group-status.ts)에 모여 있습니다.

- 연결·최신성 문제가 있으면 참여 경향을 **유보**합니다. 연결 실패가 참여 문제처럼 보이면 안 됩니다.
- 분석이 45초 이상 갱신되지 않으면 지난 경향 대신 「갱신 중단」을 표시합니다.
- 기기 하트비트가 20초 이상 끊기면 「연결 실패」로 봅니다.
- 정보가 부족하면 정상·편중을 단정하지 않습니다.

## 백엔드

현재 이 저장소의 [`backend/`](backend/) FastAPI와 `backend/livekit-worker`는 각각
독립 Railway 서비스로 배포하도록 구성되어 있습니다. FastAPI는 실제 DB readiness,
LiveKit 토큰 발급과 worker 저장 API를 담당하고 worker는 LiveKit 오디오를 Deepgram
전사로 변환합니다. 실제 배포 여부는 두 Railway 서비스에서 각각 확인해야 합니다.
전사(Deepgram)와 참여 분석(gpt-5.4-mini)을 포함한 전체 계약은
[`docs/backend-contract.md`](docs/backend-contract.md)에 정리돼 있습니다.

프론트엔드는 `utterances`와 `group_insights`를 **읽기만** 하고, 나머지 테이블에 사용자의 조작 결과를 씁니다.

## 배포

Vercel에 그대로 올릴 수 있습니다. SPA 라우팅 rewrite는 [`vercel.json`](vercel.json)에 있습니다.
프로젝트 환경변수에 `.env.example`의 항목을 등록하면 됩니다.

```bash
npm run build   # tsc -b && vite build
```
