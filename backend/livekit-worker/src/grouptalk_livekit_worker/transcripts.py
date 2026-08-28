from collections.abc import Callable, Hashable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4


class MissingSpeakerError(ValueError):
    """A final Deepgram segment violated the required diarization contract."""


@dataclass(frozen=True, slots=True)
class TranscriptEvent:
    final: bool
    text: str
    speaker_id: Hashable | None
    start_time: float


@dataclass(frozen=True, slots=True)
class NormalizedTranscript:
    source_event_id: str
    speaker_label: str
    text: str
    spoken_at: datetime


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
    event_id_factory: Callable[[], object] = uuid4,
) -> NormalizedTranscript | None:
    if not event.final:
        return None

    transcript_text = event.text.strip()
    if not transcript_text:
        return None
    if event.speaker_id is None:
        raise MissingSpeakerError("final transcript did not include a diarized speaker")

    event_epoch = stream_start_time - stream_start_time_offset + event.start_time
    return NormalizedTranscript(
        source_event_id=str(event_id_factory()),
        speaker_label=labeler.label_for(event.speaker_id),
        text=transcript_text,
        spoken_at=datetime.fromtimestamp(event_epoch, UTC),
    )
