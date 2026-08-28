# 백엔드 계약 (프론트엔드 → 백엔드)

이 문서는 프론트엔드가 이미 구현한 부분과, 백엔드 담당자가 채워야 하는 부분의 경계를 정한다.
스키마 형태는 [`supabase/schema.sql`](../supabase/schema.sql)이 기준이다.

## 역할 분담 요약

| 영역 | 담당 | 상태 |
|---|---|---|
| 교사·학생 화면 전체 | 프론트엔드 | 완료 |
| Supabase 테이블 읽기/쓰기 | 프론트엔드 | 완료 |
| Supabase Realtime 구독 | 프론트엔드 | 완료 |
| 브라우저 마이크 획득, LiveKit 룸 접속·발행 | 프론트엔드 | 완료 |
| DB 마이그레이션 적용과 RLS 확정 | 백엔드 | **필요** |
| LiveKit 토큰 발급 엔드포인트 | 백엔드 | **필요** |
| LiveKit 오디오 → Deepgram 전사 | 백엔드 | **필요** |
| 전사문 → gpt-5.4-mini 참여 분석 | 백엔드 | **필요** |

## 프론트엔드가 쓰는(write) 테이블

프론트엔드는 아래만 직접 기록한다. 백엔드는 이 값을 입력으로 받는다.

| 테이블 | 쓰는 시점 |
|---|---|
| `activities`, `activity_steps` | 교사가 활동을 만들거나 지울 때 |
| `sessions`, `session_steps` | 교사가 「시작하기」를 눌러 세션을 열 때 |
| `sessions.status` | `waiting` → `active` → `ended` (교사 조작) |
| `groups`, `group_members` | 학생이 입장할 때. 교사가 모둠 배정을 미리 쓰면 세션 생성 시에도 |
| `groups.current_step_id` | 학생이 현재 단계를 고를 때 |
| `groups.connection_state`, `groups.last_seen_at` | 학생 기기가 8초마다 갱신 |
| `help_requests` | 학생이 도움 버튼을 누를 때 / 교사가 확인 처리할 때 |
| `roster_groups`, `roster_students` | 교사가 학생 관리 탭에서 저장할 때 |

## 백엔드가 채워야 하는 테이블

프론트엔드는 아래 두 테이블을 **읽기만** 한다. 쓰지 않는다.

### `utterances` — Deepgram 전사 결과

모둠별 발화를 한 행씩 append 한다.

```json
{
  "session_id": "uuid",
  "group_id": "uuid",
  "speaker_label": "화자 A",
  "text": "나는 두 번째 근거가 더 설득력 있다고 생각해.",
  "spoken_at": "2026-08-28T10:12:03Z"
}
```

- `speaker_label`은 Deepgram diarization의 화자 번호를 사람이 읽을 수 있게 옮긴 값이다.
  프론트엔드는 이 값을 학생 이름과 절대 연결하지 않고 그대로 보여준다.
- 사후 리포트의 「텍스트 변환 데이터 내려받기」가 이 테이블을 읽는다.

### `group_insights` — 참여 분석 결과

모둠당 **한 행**을 주기적으로 upsert 한다. 프론트엔드는 realtime으로 이 변경을 받아 카드와 상세 모달을 갱신한다.

```json
{
  "group_id": "uuid",
  "session_id": "uuid",
  "participation_state": "skewed",
  "speaker_shares": [
    { "speaker_label": "화자 A", "ratio": 0.62, "utterance_count": 31 },
    { "speaker_label": "화자 B", "ratio": 0.28, "utterance_count": 14 }
  ],
  "off_topic_ratio": 0.12,
  "off_topic_evidence": [
    { "quote": "어제 그 영상 봤어?", "reason": "활동 주제와 연결되는 내용을 찾지 못했습니다.", "at": "2026-08-28T10:14:22Z" }
  ],
  "summary": "한 화자가 대부분의 발화를 이어가고 있습니다.",
  "keywords": ["근거", "출처 확인"],
  "updated_at": "2026-08-28T10:15:00Z"
}
```

`participation_state`의 의미는 기획 문서의 사용자용 상태와 1:1로 맞춰야 한다.

| 값 | 교사 화면 표시 | 언제 쓰는가 |
|---|---|---|
| `balanced` | 고른 참여 | 여러 익명 화자가 고르게 참여 |
| `skewed` | 편중 경향 | 한 화자 중심 경향 |
| `insufficient` | 정보 부족 | 판단할 발화량이 아직 부족 |
| `unknown` | 판단 불가 | 발화는 있으나 신뢰할 판단이 어려움 |

**중요한 규칙 두 가지**

1. 연결이 끊긴 모둠에는 새 분석을 쓰지 않는다. 프론트엔드가 `groups.last_seen_at`으로 연결 실패를 먼저 표시하고 참여 판단을 유보한다. 연결 문제를 참여 문제처럼 보이게 하면 안 된다.
2. `updated_at`을 항상 갱신한다. 프론트엔드는 이 값이 45초 이상 오래되면 「갱신 중단」으로 바꾸고, 지난 경향을 현재 상태처럼 보여주지 않는다.

## LiveKit 토큰 엔드포인트

프론트엔드는 학생이 활동에 들어가면 토큰을 요청한 뒤 브라우저 마이크 트랙을 룸에 발행한다.
토큰 서명은 서버에서만 가능하므로 백엔드가 아래 중 하나를 제공해야 한다.

- Supabase Edge Function 이름 `livekit-token` (기본값), 또는
- `VITE_LIVEKIT_TOKEN_ENDPOINT`에 지정한 HTTP 엔드포인트

**요청**

```json
{ "sessionId": "uuid", "groupId": "uuid", "groupName": "3모둠" }
```

**응답**

```json
{ "url": "wss://<project>.livekit.cloud", "token": "<jwt>", "roomName": "session_<sessionId>" }
```

권장 룸 구성은 세션당 룸 하나, 모둠당 참가자 하나(`identity = groupId`)다. 이렇게 두면 서버 측에서 참가자 트랙과 `group_id`를 바로 대응시킬 수 있다.

토큰 발급이 실패하면 프론트엔드는 마이크만 켜는 폴백 상태로 내려가고, 학생 화면에 「기록 안 됨」 배지를 띄운다. 화면이 죽지는 않지만 대화는 수집되지 않는다.

## 오디오 → 전사 → 분석 파이프라인

프론트엔드 밖의 영역이며 백엔드가 설계한다. 프론트엔드가 전제하는 것은 결과가 위 두 테이블에 들어온다는 것뿐이다. 일반적인 구성은 다음과 같다.

1. LiveKit 서버 SDK 또는 Egress로 룸의 참가자별 오디오를 받는다.
2. Deepgram 스트리밍 STT(한국어, diarization 켜기)로 전사한다.
3. 전사 결과를 `utterances`에 append 한다.
4. 일정 주기(예: 10~15초)로 모둠별 최근 전사문을 gpt-5.4-mini에 넣어 발화 비율·주제 이탈·요약·키워드를 만들고 `group_insights`를 upsert 한다.

## 프론트엔드가 이미 처리하는 것 (중복 구현 불필요)

- 입장 코드 생성과 QR, 재입장 시 이전 모둠 채우기
- 세션 상태에 따른 교사·학생 화면 자동 전환
- 연결 실패 판정(`last_seen_at` 기준)과 최신성 판정(`updated_at` 기준)
- 도움 요청 순서 정렬, 먼저 살펴볼 모둠 정렬
- 전사문 텍스트 파일 변환과 내려받기

## 아직 정해지지 않은 것

기획 문서가 미결정으로 남긴 항목이며 실제 학생 대상 사용 전에 정해야 한다.

- 원본 음성과 전사문의 보존 기간, 삭제 책임자
- 교사 인증과 RLS 정책 (현재 스키마의 정책은 시연용이며 보안 결정이 아니다)
- 대상 학교급과 고지·동의 절차
