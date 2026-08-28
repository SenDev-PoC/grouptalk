from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from api.realtime_analysis.models import UtteranceObservation
from api.realtime_analysis.policy import (
    ANALYSIS_VERSION,
    build_participation_insight,
)

BASE_TIME = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


def _observation(
    index: int,
    speaker_label: str,
    *,
    seconds_ago: int = 0,
    created_offset: int | None = None,
) -> UtteranceObservation:
    return UtteranceObservation(
        id=UUID(int=index + 1),
        speaker_label=speaker_label,
        spoken_at=BASE_TIME - timedelta(seconds=seconds_ago),
        created_at=BASE_TIME + timedelta(microseconds=created_offset or index),
    )


def _speakers(*counts: int) -> list[UtteranceObservation]:
    observations: list[UtteranceObservation] = []
    index = 0
    for speaker_index, count in enumerate(counts):
        label = f"화자 {chr(ord('A') + speaker_index)}"
        for _ in range(count):
            observations.append(_observation(index, label, seconds_ago=len(counts) + index))
            index += 1
    return observations


@pytest.mark.parametrize(
    ("counts", "expected_state"),
    [
        ((), "insufficient"),
        ((7,), "insufficient"),
        ((4, 4), "balanced"),
        ((6, 4), "balanced"),
        ((7, 3), "unknown"),
        ((9, 3), "skewed"),
        ((8, 2), "skewed"),
    ],
)
def test_participation_count_v1_classifies_approved_fixtures(
    counts: tuple[int, ...], expected_state: str
) -> None:
    result = build_participation_insight(_speakers(*counts))

    assert result.participation_state == expected_state
    assert result.analysis_version == ANALYSIS_VERSION
    assert result.data_source == "live"


def test_empty_window_is_explicitly_insufficient() -> None:
    result = build_participation_insight([])

    assert result.data_sufficiency == "none"
    assert result.judgability == "unjudgable"
    assert result.reason_code == "insufficient_utterances"
    assert result.speaker_shares == ()
    assert result.evidence_from is None
    assert result.evidence_to is None
    assert result.observation_count == 0


@pytest.mark.parametrize(
    ("counts", "expected_sufficiency", "expected_judgability", "expected_reason"),
    [
        ((7,), "insufficient", "unjudgable", "insufficient_utterances"),
        ((6, 4), "sufficient", "judgable", None),
        ((7, 3), "sufficient", "unjudgable", "borderline_distribution"),
        ((8, 2), "sufficient", "judgable", None),
    ],
)
def test_judgability_and_reason_follow_the_participation_state(
    counts: tuple[int, ...],
    expected_sufficiency: str,
    expected_judgability: str,
    expected_reason: str | None,
) -> None:
    result = build_participation_insight(_speakers(*counts))

    assert result.data_sufficiency == expected_sufficiency
    assert result.judgability == expected_judgability
    assert result.reason_code == expected_reason


def test_shares_are_stable_and_preserve_evidence_range() -> None:
    observations = [
        _observation(0, "화자 B", seconds_ago=20),
        _observation(1, "화자 A", seconds_ago=10),
        _observation(2, "화자 B", seconds_ago=5),
        _observation(3, "화자 A", seconds_ago=0),
        *_speakers(2, 2),
    ]

    result = build_participation_insight(observations)

    assert [share.speaker_label for share in result.speaker_shares] == ["화자 A", "화자 B"]
    assert [share.utterance_count for share in result.speaker_shares] == [4, 4]
    assert sum(share.ratio for share in result.speaker_shares) == pytest.approx(1)
    assert result.evidence_from == BASE_TIME - timedelta(seconds=20)
    assert result.evidence_to == BASE_TIME
    assert result.observation_count == 8


def test_window_uses_latest_five_minutes_and_at_most_twenty_rows() -> None:
    old = _observation(99, "화자 B", seconds_ago=301)
    recent = [
        _observation(index, "화자 A" if index < 15 else "화자 B", seconds_ago=index)
        for index in range(21)
    ]

    result = build_participation_insight([old, *recent])

    assert result.observation_count == 20
    assert result.evidence_from == BASE_TIME - timedelta(seconds=19)
    assert result.evidence_to == BASE_TIME
    assert [(share.speaker_label, share.utterance_count) for share in result.speaker_shares] == [
        ("화자 A", 15),
        ("화자 B", 5),
    ]
    assert result.participation_state == "skewed"
