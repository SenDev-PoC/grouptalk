from collections import Counter, defaultdict
from collections.abc import Iterable
from datetime import timedelta

from .models import ParticipationInsight, SpeakerShare, UtteranceObservation

ANALYSIS_VERSION = "participation-duration-v1"
WINDOW_DURATION = timedelta(seconds=120)
BALANCED_MIN_EQUITY = 0.75


def _window_sort_key(observation: UtteranceObservation) -> tuple[object, ...]:
    return (observation.spoken_at, observation.created_at, str(observation.id))


def select_analysis_window(
    observations: Iterable[UtteranceObservation],
) -> tuple[UtteranceObservation, ...]:
    ordered = sorted(observations, key=_window_sort_key, reverse=True)
    if not ordered:
        return ()

    window_start = ordered[0].spoken_at - WINDOW_DURATION
    selected = [item for item in ordered if item.spoken_at >= window_start]
    return tuple(sorted(selected, key=_window_sort_key))


def _one_minus_gini(values: list[int]) -> float:
    total = sum(values)
    if not values or total <= 0:
        raise ValueError("participation vector must contain speaking time")
    pairwise_difference = sum(abs(left - right) for left in values for right in values)
    return 1 - pairwise_difference / (2 * len(values) * total)


def _insufficient(
    *,
    reason_code: str,
    joined_participant_count: int | None,
) -> ParticipationInsight:
    return ParticipationInsight(
        participation_state="insufficient",
        speaker_shares=(),
        data_sufficiency="none" if joined_participant_count is None else "insufficient",
        judgability="unjudgable",
        reason_code=reason_code,
        evidence_from=None,
        evidence_to=None,
        observation_count=0,
        analysis_version=ANALYSIS_VERSION,
        participation_equity=None,
        total_speaking_ms=None,
        joined_participant_count=joined_participant_count,
        silent_participant_count=None,
    )


def build_participation_insight(
    observations: Iterable[UtteranceObservation],
    *,
    joined_participant_count: int,
) -> ParticipationInsight:
    if joined_participant_count <= 0:
        return _insufficient(
            reason_code="missing_group_members",
            joined_participant_count=None,
        )

    window = select_analysis_window(observations)
    if not window:
        return _insufficient(
            reason_code="insufficient_utterances",
            joined_participant_count=joined_participant_count,
        )

    durations: dict[str, int] = defaultdict(int)
    counts: Counter[str] = Counter()
    for observation in window:
        durations[observation.speaker_label] += observation.speaking_ms
        counts[observation.speaker_label] += 1

    detected_speaker_count = len(durations)
    if detected_speaker_count > joined_participant_count:
        return ParticipationInsight(
            participation_state="unknown",
            speaker_shares=(),
            data_sufficiency="sufficient",
            judgability="unjudgable",
            reason_code="detected_speakers_exceed_members",
            evidence_from=window[0].spoken_at,
            evidence_to=window[-1].spoken_at + timedelta(milliseconds=window[-1].speaking_ms),
            observation_count=len(window),
            analysis_version=ANALYSIS_VERSION,
            participation_equity=None,
            total_speaking_ms=None,
            joined_participant_count=joined_participant_count,
            silent_participant_count=None,
        )

    total_speaking_ms = sum(durations.values())
    vector = list(durations.values())
    vector.extend([0] * (joined_participant_count - detected_speaker_count))
    equity = round(_one_minus_gini(vector), 6)
    shares = tuple(
        SpeakerShare(
            speaker_label=speaker_label,
            ratio=duration / total_speaking_ms,
            utterance_count=counts[speaker_label],
            speaking_time_ms=duration,
        )
        for speaker_label, duration in sorted(
            durations.items(), key=lambda item: (-item[1], item[0])
        )
    )

    return ParticipationInsight(
        participation_state="balanced" if equity >= BALANCED_MIN_EQUITY else "skewed",
        speaker_shares=shares,
        data_sufficiency="sufficient",
        judgability="judgable",
        reason_code=None,
        evidence_from=window[0].spoken_at,
        evidence_to=window[-1].spoken_at + timedelta(milliseconds=window[-1].speaking_ms),
        observation_count=len(window),
        analysis_version=ANALYSIS_VERSION,
        participation_equity=equity,
        total_speaking_ms=total_speaking_ms,
        joined_participant_count=joined_participant_count,
        silent_participant_count=joined_participant_count - detected_speaker_count,
    )
