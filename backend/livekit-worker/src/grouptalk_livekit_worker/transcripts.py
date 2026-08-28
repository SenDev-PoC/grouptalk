import hashlib
import json
from collections.abc import Hashable
from dataclasses import dataclass
from datetime import UTC, datetime


@dataclass(frozen=True, slots=True)
class TranscriptEvent:
    final: bool
    text: str
    speaker_id: Hashable | None
    start_time: float
    end_time: float
    request_id: str | None = None


@dataclass(frozen=True, slots=True)
class NormalizedTranscript:
    source_event_id: str
    speaker_label: str | None
    text: str
    spoken_at: datetime
    start_ms: int
    end_ms: int


class SpeakerLabeler:
    """Assign anonymous Excel-style labels in stream-local first-seen order."""

    def __init__(self) -> None:
        self._labels: dict[Hashable, str] = {}

    def label_for(self, speaker_id: Hashable) -> str:
        if speaker_id not in self._labels:
            self._labels[speaker_id] = f"화자 {self._alphabetic_label(len(self._labels))}"
        return self._labels[speaker_id]

    @staticmethod
    def _alphabetic_label(index: int) -> str:
        label = ""
        remaining = index + 1
        while remaining:
            remaining, remainder = divmod(remaining - 1, 26)
            label = chr(ord("A") + remainder) + label
        return label


def normalize_final_transcript(
    event: TranscriptEvent,
    *,
    labeler: SpeakerLabeler,
    stream_start_time: float,
    stream_start_time_offset: float,
) -> NormalizedTranscript | None:
    if not event.final:
        return None

    transcript_text = event.text.strip()
    if not transcript_text:
        return None
    start_ms = round(event.start_time * 1000)
    end_ms = round(event.end_time * 1000)
    if event.start_time < 0 or event.end_time <= event.start_time or end_ms <= start_ms:
        raise ValueError("final transcript timing must satisfy 0 <= start_time < end_time")

    event_epoch = stream_start_time - stream_start_time_offset + event.start_time
    return NormalizedTranscript(
        source_event_id=_source_event_id(
            event=event,
            text=transcript_text,
            start_ms=start_ms,
            end_ms=end_ms,
        ),
        speaker_label=(
            labeler.label_for(event.speaker_id) if event.speaker_id is not None else None
        ),
        text=transcript_text,
        spoken_at=datetime.fromtimestamp(event_epoch, UTC),
        start_ms=start_ms,
        end_ms=end_ms,
    )


def _source_event_id(
    *,
    event: TranscriptEvent,
    text: str,
    start_ms: int,
    end_ms: int,
) -> str:
    canonical = json.dumps(
        {
            "version": "deepgram-final-v1",
            "request_id": event.request_id,
            "provider_speaker_id": (
                str(event.speaker_id) if event.speaker_id is not None else None
            ),
            "text": text,
            "start_ms": start_ms,
            "end_ms": end_ms,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
