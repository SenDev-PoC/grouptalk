# LiveKit Worker

LiveKit Agents Python worker를 위한 독립 Python 프로젝트다. worker는 Supabase에
직접 접근하지 않고 Railway private network를 통해 `backend/api`를 호출한다.

현재 첫 기능은 LiveKit의 active-speaker 이벤트를 익명 화자별 구조화 관찰로
바꾸는 집계기다. 원본 음성·전사문·LiveKit participant identity는 출력이나 DB에
저장하지 않고 다음 필드만 만든다.

- `speaker_label`: 최초 관찰 순서에 따른 `화자 A`, `화자 B` 형식
- `speaking_ms`: 관찰 구간의 발화 시간
- `turn_count`: 새로 발화를 시작한 횟수
- `occurred_at`: 관찰 구간 종료 시각

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 pytest
```
