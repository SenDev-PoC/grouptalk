# 모둠뷰

> 실시간 모둠 협력 학습 지원 시스템

[🌐 바로 사용하기](https://modum-view.vercel.app/) [💻 소스코드](https://github.com/SenDev-PoC/modum-view) [▶️ 시연 보기](https://youtu.be/Fhqqdo-XlFw)

## 대표 화면과 링크

![대표 화면](https://dutmlwajdhdbjmdijefy.supabase.co/storage/v1/object/sign/post-images/comment-e901eb10-a026-41bd-a414-61e90c6ec40a.jpg?token=eyJraWQiOiI4ZmZiMjFmMC1hMjhmLTRiM2QtODJlMi1jYjJiNDgxNTBmYjUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwb3N0LWltYWdlcy9jb21tZW50LWU5MDFlYjEwLWEwMjYtNDFiZC1hNDE0LTYxZTkwYzZlYzQwYS5qcGciLCJzY29wZSI6ImRvd25sb2FkIiwiaWF0IjoxNzg3OTY4Mjk1LCJleHAiOjIxMDMzMjgyOTV9.7wBHYWou7WRVbtkbG1g4ISpPxqLfafPlWUIoD9zUR8k)

## 최종적으로 해결한 문제

- 효과적인 모둠 편성의 어려움  
- 실시간 모둠 협력 과정 파악의 어려움  
- 여러 모둠의 도움 요청에 적시에 대응하기 어려움  
- 모둠별 활동 진행 상황 파악의 어려움

### 어떻게 풀었나요?

"교사의 눈과 귀가 되어주는 AI"를 목표로 잡음. 모둠 공용 기기의 대화를 익명 화자로 전사한 뒤, 참여 경향과 연결 문제를 구분해 교사 화면에 네 가지 상태(고른 참여·편중 경향·정보 부족·연결 실패)로 보여 줌. 교사는 모든 대화를 읽지 않고도 지금 먼저 살펴볼 모둠을 고를 수 있음. 또한 현재 모둠에서 일어나는 대화의 주요 내용과 키워드도 추출해 해당 모둠에서 어떤 대화를 주로 나눴는지 한눈에 알 수 있음.

## 핵심 기능

- **조건 기반 모둠 편성**: 학급 명단을 등록하고 수업 목적에 맞는 기준으로 조를 나눠 수업 전에 확정합니다
- **QR 한 번에 입장**: 활동 QR·코드로 모둠 공용 기기가 계정 없이 바로 수업에 들어옵니다
- **실시간 참여 대시보드**: 모둠별 발화 균형을 한 화면에서 비교하며 먼저 다가갈 모둠을 고릅니다
- **네 가지 상태 구분**: 고른 참여, 편중 경향, 정보 부족, 연결 실패를 서로 다른 상태로 보여 줍니다
- **도움 요청 가시화**: 모둠이 손을 들면 교사 화면에 요청 모둠과 순서가 표시됩니다
- **사후 리포트**: 활동 종료 후 요약·키워드와 전사문을 확인하고 내려받아, 수업 중 보지 못한 순간까지 되짚습니다

## 사용 흐름과 사용 방법

1. 1. 교사가 학급 명단을 등록하고 모둠을 편성한다
2. 2. 활동을 만든 뒤 QR을 공유한다
3. 3. 모둠 공용 기기가 QR로 입장하고 교사의 시작을 기다린다
4. 4. 교사가 활동을 시작하면 모둠 공용 마이크로 대화가 수집·전사된다
5. 5. 교사가 대시보드에서 먼저 볼 모둠을 고르고 직접 찾아가 확인한다
6. 6. 활동을 종료하면 요약 리포트와 전사문을 확인한다

- 사용 환경: PC 웹(교사), 모바일·태블릿 웹(학생 모둠 공용 기기)
- 사용 조건: 무료. 교사만 이메일 계정 가입이 필요하고, 학생들의 모둠 기기는 QR/링크와 마이크만 있으면 별도 계정 없이 입장가능.

## 기술 스택과 실행 방법

- **화면**: React, Typescript, Tailwind CSS
- **서버·백엔드**: Python, FastAPI, LiveKit
- **AI**: Deepgram nova-3(실시간 전사·화자 구분), OpenAI GPT-5.6-Luna API(요약·키워드·주제 관련성)
- **저장소**: PostgreSQL (Supabase)
- **배포**: Vercel(프론트), Railway(백엔드), LiveKit Cloud(실시간 오디오)

### 폴더 구조

```text
/src                         교사·모둠 웹앱 (React + Vite)
  pages/teacher/             활동 홈, 대기실, 실시간 대시보드, 리포트, 모둠 편성
  pages/student/             QR 입장, 모둠 룸(대기·수집·종료)
  lib/group-status.ts        참여 경향과 연결 문제를 구분하는 표시 규칙
/backend                     FastAPI
  api/livekit_tokens.py      LiveKit 토큰 발급
  api/worker_utterances.py   전사 저장
  api/realtime_analysis/     발화 시간 기반 참여 균형 계산
  api/conversation_analysis/ 요약·키워드·주제 관련성 worker
/backend/livekit-worker      LiveKit → Deepgram 전사 worker
/supabase                    스키마와 migration
/docs                        제품 기획, 백엔드 계약
```

### 설치와 실행

```bash
npm install cp .env.example .env.local cd backend && uv sync cd backend/livekit-worker && uv sync
# 프론트엔드 npm run dev  # 백엔드 API cd backend && uv run uvicorn api.main:app --reload --host 0.0.0.0 --port 8000  # LiveKit 전사 worker cd backend/livekit-worker && uv run python -m grouptalk_livekit_worker.agent dev  # 대화 분석 worker cd backend && uv run python -m api.conversation_analysis.main
```

- 필요한 환경변수(이름만): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_LIVEKIT_TOKEN_ENDPOINT, DATABASE_URL, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, DEEPGRAM_API_KEY, OPENAI_API_KEY, WORKER_API_TOKEN

## 작동 범위와 한계, 다음 계획

### 기술적 한계

- 1. 여러 사람이 동시에 말하면 익명 화자 구분이 어긋날 수 있습니다  
2. 원본 음성은 저장하지 않지만, 전사문 보존 기간과 삭제 절차는 아직 정하지 못했습니다  
3. 실제 교실의 소음·기기 환경에서 정확성을 보증하지 않습니다 (지금까지는 데모 데이터와 동의한 성인 시연으로만 확인)  
4. 모둠마다 마이크가 있는 공용 기기가 필요하고, 연결이 끊기면 해당 모둠의 분석이 멈춥니다

### 다음 계획

- - 대화 단계(시작·논의·정리)를 교사 화면에 더 분명하게 보여 주기  
- 화자 구분 성능을 높일 수 있도록 여러 STT 모델을 쓰면서 실험해보기  
- 실시간 처리에 대한 부하 테스트 및 교실 상황에서 배포를 위해 고려할 사항 검토하기

## 교육 현장에서 사용할 때의 주의사항

### 교육적 태도 점검

- 평가·추천·피드백을 프로그램이 대신 확정하지 않게 했나요?: 우리 프로그램엔 해당 없어요
- 학생이나 교사의 생각을 대신하지 않게 했나요?: 우리 프로그램엔 해당 없어요
- 저장·전달·제출 전에 사람이 확인할 수 있나요?: 원래 그렇게 했어요
- 기기·계정·조작 문제로 참여에서 빠지는 사람이 없게 했나요?: 원래 그렇게 했어요

## 제작자와 라이선스

- 고준보 · 묘곡초등학교 영어전담 · 기획-문제정의-백엔드 개발
- 박혜리 · 금천고등학교 영어교사 · 기획-문제정의-프론트엔드 개발
- 김영선 · 오디세이학교 영어교사 · 기획-문제정의-UX 디자인
- **코드 라이선스**: MIT
- **문서 라이선스**: CC BY 4.0
- **외부 자료 출처**: Deepgram nova-3 API, OpenAI Responses API, LiveKit Agents(Apache-2.0), Supabase — 각 서비스 이용약관에 따름

## 교사 개발자 윤리 자가점검

- 응답 인원: 3명 / 팀원 3명

| 원칙 | 평균 점수 |
| --- | --- |
| 학생 성장 최우선 | 5.0 / 5.0 |
| 개인정보·데이터 보호 | 4.2 / 5.0 |
| 책임과 출처 존중 | 5.0 / 5.0 |
| 안전한 실험과 검증 | 4.7 / 5.0 |
| 역할 경계 인식 | 5.0 / 5.0 |
| 공공성 | 5.0 / 5.0 |
| 투명성 및 설명 가능성 | 4.7 / 5.0 |
| **전체 평균** | **4.8 / 5.0** |

### 우리가 더한 약속

- 김영선: 학생에게 도구의 목적을 바로 알고 목적에 맞게 사용하도록 지도하기, 학생에게 도구를 통해 배움을 확장하고 성장하려는 마인드를 가르치기
- 박혜리: 교육 현장에서 기술이 목적이 아닌 수단이 되는 것
- 고준보: 내가 개발하려고 하는게 꼭 세상에 필요한 것인지 검토를 하고 불필요한 코드와 서비스를 양산하지 않기

