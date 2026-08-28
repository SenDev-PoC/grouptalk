from datetime import UTC, datetime, timedelta

import pytest

from grouptalk_livekit_worker.observations import ObservationTracker

START = datetime(2026, 8, 28, 12, 0, tzinfo=UTC)


def test_tracks_anonymous_speaking_time_and_turns() -> None:
    tracker = ObservationTracker(started_at=START)

    tracker.update_active_speakers(["livekit-participant-123"], at=START)
    tracker.update_active_speakers([], at=START + timedelta(milliseconds=2250))

    observations = tracker.drain(at=START + timedelta(seconds=5))

    assert len(observations) == 1
    assert observations[0].speaker_label == "화자 A"
    assert observations[0].speaking_ms == 2250
    assert observations[0].turn_count == 1
    assert observations[0].occurred_at == START + timedelta(seconds=5)
    assert "livekit-participant-123" not in repr(observations)


def test_tracks_overlapping_speakers_independently() -> None:
    tracker = ObservationTracker(started_at=START)

    tracker.update_active_speakers(["p1"], at=START)
    tracker.update_active_speakers(["p1", "p2"], at=START + timedelta(seconds=1))
    tracker.update_active_speakers(["p2"], at=START + timedelta(seconds=3))

    observations = tracker.drain(at=START + timedelta(seconds=4))

    assert [(item.speaker_label, item.speaking_ms, item.turn_count) for item in observations] == [
        ("화자 A", 3000, 1),
        ("화자 B", 3000, 1),
    ]


def test_drain_rolls_an_active_speaker_into_the_next_window_without_a_new_turn() -> None:
    tracker = ObservationTracker(started_at=START)
    tracker.update_active_speakers(["p1"], at=START)

    first = tracker.drain(at=START + timedelta(seconds=2))
    second = tracker.drain(at=START + timedelta(seconds=5))

    assert (first[0].speaking_ms, first[0].turn_count) == (2000, 1)
    assert (second[0].speaking_ms, second[0].turn_count) == (3000, 0)


def test_rejects_naive_or_non_monotonic_timestamps() -> None:
    tracker = ObservationTracker(started_at=START)

    with pytest.raises(ValueError, match="timezone-aware"):
        tracker.update_active_speakers(["p1"], at=datetime(2026, 8, 28, 12, 0))

    tracker.update_active_speakers(["p1"], at=START + timedelta(seconds=2))
    with pytest.raises(ValueError, match="monotonic"):
        tracker.update_active_speakers([], at=START + timedelta(seconds=1))
