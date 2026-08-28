"""Aggregate LiveKit active-speaker events without retaining audio or transcripts."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class SpeakerObservation:
    """One anonymous speaker's structured metrics for an observation window."""

    speaker_label: str
    speaking_ms: int
    turn_count: int
    occurred_at: datetime


class ObservationTracker:
    """Convert participant activity into anonymous speaking-time observations.

    LiveKit participant identities stay only in this in-memory tracker. Drained
    observations contain an assigned anonymous label and numeric metrics only.
    """

    def __init__(self, *, started_at: datetime) -> None:
        self._ensure_timezone_aware(started_at)
        self._last_event_at = started_at
        self._labels: dict[str, str] = {}
        self._active_since: dict[str, datetime] = {}
        self._speaking_ms: dict[str, int] = {}
        self._turn_count: dict[str, int] = {}

    def update_active_speakers(self, identities: Iterable[str], *, at: datetime) -> None:
        """Apply the complete set of speakers LiveKit reports as active at ``at``."""

        self._validate_event_time(at)
        active = set(identities)
        if "" in active:
            raise ValueError("speaker identity must not be empty")

        previous = set(self._active_since)
        for identity in previous - active:
            self._record_elapsed(identity, until=at)
            del self._active_since[identity]

        for identity in active - previous:
            self._label_for(identity)
            self._active_since[identity] = at
            self._turn_count[identity] = self._turn_count.get(identity, 0) + 1

        self._last_event_at = at

    def drain(self, *, at: datetime) -> list[SpeakerObservation]:
        """Return and reset the current window while preserving ongoing speakers."""

        self._validate_event_time(at)
        for identity in self._active_since:
            self._record_elapsed(identity, until=at)
            self._active_since[identity] = at

        identities = {
            identity
            for identity in self._labels
            if self._speaking_ms.get(identity, 0) > 0 or self._turn_count.get(identity, 0) > 0
        }
        observations = [
            SpeakerObservation(
                speaker_label=self._labels[identity],
                speaking_ms=self._speaking_ms.get(identity, 0),
                turn_count=self._turn_count.get(identity, 0),
                occurred_at=at,
            )
            for identity in sorted(identities, key=self._labels.get)
        ]

        self._speaking_ms.clear()
        self._turn_count.clear()
        self._last_event_at = at
        return observations

    def _record_elapsed(self, identity: str, *, until: datetime) -> None:
        started_at = self._active_since[identity]
        elapsed_ms = round((until - started_at).total_seconds() * 1000)
        self._speaking_ms[identity] = self._speaking_ms.get(identity, 0) + elapsed_ms

    def _label_for(self, identity: str) -> str:
        if identity not in self._labels:
            self._labels[identity] = f"화자 {self._alphabetic_label(len(self._labels))}"
        return self._labels[identity]

    @staticmethod
    def _alphabetic_label(index: int) -> str:
        label = ""
        remaining = index + 1
        while remaining:
            remaining, remainder = divmod(remaining - 1, 26)
            label = chr(ord("A") + remainder) + label
        return label

    def _validate_event_time(self, at: datetime) -> None:
        self._ensure_timezone_aware(at)
        if at < self._last_event_at:
            raise ValueError("observation timestamps must be monotonic")

    @staticmethod
    def _ensure_timezone_aware(value: datetime) -> None:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observation timestamps must be timezone-aware")
