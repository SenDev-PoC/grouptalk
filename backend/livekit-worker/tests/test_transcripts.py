from datetime import UTC, datetime

import pytest

from grouptalk_livekit_worker.transcripts import (
    MissingSpeakerError,
    SpeakerLabeler,
    TranscriptEvent,
    normalize_final_transcript,
)


def test_assigns_excel_style_labels_in_first_seen_order() -> None:
    labeler = SpeakerLabeler()

    assert [labeler.label_for(value) for value in (1, 0, 1)] == ["화자 A", "화자 B", "화자 A"]
    assert SpeakerLabeler().label_for("separate-group-speaker") == "화자 A"

    many = SpeakerLabeler()
    assert [many.label_for(index) for index in range(28)][-3:] == ["화자 Z", "화자 AA", "화자 AB"]


@pytest.mark.parametrize(
    "event",
    [
        TranscriptEvent(final=False, text="중간 결과", speaker_id=0, start_time=1.0),
        TranscriptEvent(final=True, text="   ", speaker_id=0, start_time=1.0),
    ],
)
def test_discards_interim_and_empty_final(event: TranscriptEvent) -> None:
    assert (
        normalize_final_transcript(
            event,
            labeler=SpeakerLabeler(),
            stream_start_time=100.0,
            stream_start_time_offset=0.0,
            event_id_factory=lambda: "event-id",
        )
        is None
    )


def test_rejects_final_without_a_speaker() -> None:
    with pytest.raises(MissingSpeakerError):
        normalize_final_transcript(
            TranscriptEvent(final=True, text="발화", speaker_id=None, start_time=1.0),
            labeler=SpeakerLabeler(),
            stream_start_time=100.0,
            stream_start_time_offset=0.0,
        )


@pytest.mark.parametrize(
    ("stream_start_time", "offset", "event_start", "expected_epoch"),
    [
        (1_800_000_000.0, 0.0, 2.5, 1_800_000_002.5),
        (1_800_000_100.0, 100.0, 102.5, 1_800_000_102.5),
    ],
)
def test_normalizes_initial_and_reconnected_stream_timestamps(
    stream_start_time: float,
    offset: float,
    event_start: float,
    expected_epoch: float,
) -> None:
    transcript = normalize_final_transcript(
        TranscriptEvent(final=True, text="  의견입니다.  ", speaker_id=7, start_time=event_start),
        labeler=SpeakerLabeler(),
        stream_start_time=stream_start_time,
        stream_start_time_offset=offset,
        event_id_factory=lambda: "fixed-event-id",
    )

    assert transcript is not None
    assert transcript.source_event_id == "fixed-event-id"
    assert transcript.speaker_label == "화자 A"
    assert transcript.text == "의견입니다."
    assert transcript.spoken_at == datetime.fromtimestamp(expected_epoch, UTC)
