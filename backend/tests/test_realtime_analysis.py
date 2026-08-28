from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from api.realtime_analysis.alerts import (
    ParticipationAlertState,
    advance_participation_alert,
)
from api.realtime_analysis.models import UtteranceObservation
from api.realtime_analysis.policy import ANALYSIS_VERSION, build_participation_insight

BASE_TIME = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


def _observation(
    index: int,
    speaker_label: str,
    *,
    seconds_ago: int = 0,
    duration_ms: int = 1_000,
) -> UtteranceObservation:
    start_ms = index * 2_000
    return UtteranceObservation(
        id=UUID(int=index + 1),
        speaker_label=speaker_label,
        spoken_at=BASE_TIME - timedelta(seconds=seconds_ago),
        created_at=BASE_TIME + timedelta(microseconds=index),
        start_ms=start_ms,
        end_ms=start_ms + duration_ms,
    )


def test_duration_not_utterance_count_drives_speaker_shares() -> None:
    observations = [
        _observation(0, "화자 A", seconds_ago=10, duration_ms=8_000),
        _observation(1, "화자 B", seconds_ago=8, duration_ms=1_000),
        _observation(2, "화자 B", seconds_ago=6, duration_ms=1_000),
    ]

    result = build_participation_insight(observations, joined_participant_count=2)

    assert result.analysis_version == ANALYSIS_VERSION
    assert result.total_speaking_ms == 10_000
    assert result.participation_equity == pytest.approx(0.7)
    assert result.participation_state == "skewed"
    assert [
        (share.speaker_label, share.ratio, share.utterance_count, share.speaking_time_ms)
        for share in result.speaker_shares
    ] == [
        ("화자 A", 0.8, 1, 8_000),
        ("화자 B", 0.2, 2, 2_000),
    ]


def test_silent_group_members_are_included_in_equity() -> None:
    observations = [
        _observation(0, "화자 A", seconds_ago=2, duration_ms=2_000),
        _observation(1, "화자 B", seconds_ago=0, duration_ms=2_000),
    ]

    result = build_participation_insight(observations, joined_participant_count=4)

    assert result.participation_equity == pytest.approx(0.5)
    assert result.joined_participant_count == 4
    assert result.silent_participant_count == 2
    assert result.participation_state == "skewed"


def test_equal_speaking_time_for_all_members_is_balanced() -> None:
    result = build_participation_insight(
        [
            _observation(0, "화자 A", seconds_ago=3),
            _observation(1, "화자 B", seconds_ago=2),
            _observation(2, "화자 C", seconds_ago=1),
            _observation(3, "화자 D", seconds_ago=0),
        ],
        joined_participant_count=4,
    )

    assert result.participation_equity == 1
    assert result.participation_state == "balanced"
    assert result.silent_participant_count == 0


def test_missing_roster_and_empty_window_are_explicitly_insufficient() -> None:
    missing_roster = build_participation_insight(
        [_observation(0, "화자 A")],
        joined_participant_count=0,
    )
    empty = build_participation_insight([], joined_participant_count=4)

    assert missing_roster.reason_code == "missing_group_members"
    assert missing_roster.participation_equity is None
    assert empty.reason_code == "insufficient_utterances"
    assert empty.joined_participant_count == 4


def test_detected_speakers_cannot_exceed_group_members() -> None:
    result = build_participation_insight(
        [_observation(0, "화자 A"), _observation(1, "화자 B")],
        joined_participant_count=1,
    )

    assert result.participation_state == "unknown"
    assert result.reason_code == "detected_speakers_exceed_members"
    assert result.participation_equity is None


def test_window_uses_latest_120_seconds_without_count_limit() -> None:
    old = _observation(99, "화자 B", seconds_ago=121)
    recent = [
        _observation(index, "화자 A" if index < 15 else "화자 B", seconds_ago=index)
        for index in range(30)
    ]

    result = build_participation_insight([old, *recent], joined_participant_count=2)

    assert result.observation_count == 30
    assert result.evidence_from == BASE_TIME - timedelta(seconds=29)
    assert old.id not in {item.id for item in recent}


def test_alert_requires_sustained_low_equity_then_recovers_with_cooldown() -> None:
    state = ParticipationAlertState.initial()
    state = advance_participation_alert(state, equity=0.49, observed_at=BASE_TIME)
    assert state.status == "PENDING"

    state = advance_participation_alert(
        state,
        equity=0.49,
        observed_at=BASE_TIME + timedelta(seconds=119),
    )
    assert state.status == "PENDING"

    state = advance_participation_alert(
        state,
        equity=0.49,
        observed_at=BASE_TIME + timedelta(seconds=120),
    )
    assert state.status == "ACTIVE"

    state = advance_participation_alert(
        state,
        equity=0.6,
        observed_at=BASE_TIME + timedelta(seconds=130),
    )
    assert state.status == "ACTIVE"
    state = advance_participation_alert(
        state,
        equity=0.6,
        observed_at=BASE_TIME + timedelta(seconds=160),
    )
    assert state.status == "NORMAL"
    assert state.cooldown_until == BASE_TIME + timedelta(seconds=220)

    state = advance_participation_alert(
        state,
        equity=0.2,
        observed_at=BASE_TIME + timedelta(seconds=180),
    )
    assert state.status == "NORMAL"


def test_pending_alert_is_cancelled_when_equity_normalizes() -> None:
    pending = advance_participation_alert(
        ParticipationAlertState.initial(),
        equity=0.2,
        observed_at=BASE_TIME,
    )

    normalized = advance_participation_alert(
        pending,
        equity=0.5,
        observed_at=BASE_TIME + timedelta(seconds=30),
    )

    assert normalized.status == "NORMAL"
    assert normalized.pending_since is None
