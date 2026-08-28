from datetime import UTC, datetime

import pytest

from grouptalk_livekit_worker.transcripts import (
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
        TranscriptEvent(final=False, text="중간 결과", speaker_id=0, start_time=1.0, end_time=1.5),
        TranscriptEvent(final=True, text="   ", speaker_id=0, start_time=1.0, end_time=1.5),
    ],
)
def test_discards_interim_and_empty_final(event: TranscriptEvent) -> None:
    assert (
        normalize_final_transcript(
            event,
            labeler=SpeakerLabeler(),
            stream_start_time=100.0,
            stream_start_time_offset=0.0,
        )
        is None
    )


def test_preserves_final_without_a_speaker() -> None:
    transcript = normalize_final_transcript(
        TranscriptEvent(
            final=True,
            text="발화",
            speaker_id=None,
            start_time=1.0,
            end_time=1.5,
            request_id="request-1",
        ),
        labeler=SpeakerLabeler(),
        stream_start_time=100.0,
        stream_start_time_offset=0.0,
    )

    assert transcript is not None
    assert transcript.speaker_label is None
    assert len(transcript.source_event_id) == 64


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
        TranscriptEvent(
            final=True,
            text="  의견입니다.  ",
            speaker_id=7,
            start_time=event_start,
            end_time=event_start + 1.25,
        ),
        labeler=SpeakerLabeler(),
        stream_start_time=stream_start_time,
        stream_start_time_offset=offset,
    )

    assert transcript is not None
    duplicate = normalize_final_transcript(
        TranscriptEvent(
            final=True,
            text="  의견입니다.  ",
            speaker_id=7,
            start_time=event_start,
            end_time=event_start + 1.25,
        ),
        labeler=SpeakerLabeler(),
        stream_start_time=stream_start_time,
        stream_start_time_offset=offset,
    )
    assert duplicate is not None
    assert transcript.source_event_id == duplicate.source_event_id
    assert transcript.speaker_label == "화자 A"
    assert transcript.text == "의견입니다."
    assert transcript.spoken_at == datetime.fromtimestamp(expected_epoch, UTC)
    assert transcript.start_ms == round(event_start * 1000)
    assert transcript.end_ms == round((event_start + 1.25) * 1000)


def test_rejects_invalid_final_timing() -> None:
    with pytest.raises(ValueError, match="timing"):
        normalize_final_transcript(
            TranscriptEvent(
                final=True,
                text="발화",
                speaker_id=0,
                start_time=2.0,
                end_time=2.0,
            ),
            labeler=SpeakerLabeler(),
            stream_start_time=100.0,
            stream_start_time_offset=0.0,
        )


def test_deterministic_id_changes_with_provider_identity_or_timing() -> None:
    def normalize(event: TranscriptEvent):
        return normalize_final_transcript(
            event,
            labeler=SpeakerLabeler(),
            stream_start_time=100.0,
            stream_start_time_offset=0.0,
        )

    original = normalize(
        TranscriptEvent(
            final=True,
            text="같은 발화",
            speaker_id="S0",
            start_time=1.0,
            end_time=1.5,
            request_id="request-1",
        )
    )
    changed = normalize(
        TranscriptEvent(
            final=True,
            text="같은 발화",
            speaker_id="S0",
            start_time=1.1,
            end_time=1.5,
            request_id="request-1",
        )
    )

    assert original is not None and changed is not None
    assert original.source_event_id != changed.source_event_id
