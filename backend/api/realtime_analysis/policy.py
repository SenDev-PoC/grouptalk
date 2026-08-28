from collections import Counter
from collections.abc import Iterable
from datetime import timedelta

from .models import ParticipationInsight, SpeakerShare, UtteranceObservation

ANALYSIS_VERSION = "participation-count-v1"
WINDOW_DURATION = timedelta(minutes=5)
MAX_OBSERVATIONS = 20
MIN_JUDGABLE_OBSERVATIONS = 8
BALANCED_MAX_SHARE = 0.60
SKEWED_MIN_SHARE = 0.75


def _window_sort_key(observation: UtteranceObservation) -> tuple[object, ...]:
    return (observation.spoken_at, observation.created_at, str(observation.id))


def select_analysis_window(
    observations: Iterable[UtteranceObservation],
) -> tuple[UtteranceObservation, ...]:
    ordered = sorted(observations, key=_window_sort_key, reverse=True)
    if not ordered:
        return ()

    window_start = ordered[0].spoken_at - WINDOW_DURATION
    selected = [item for item in ordered if item.spoken_at >= window_start][:MAX_OBSERVATIONS]
    return tuple(sorted(selected, key=_window_sort_key))


def build_participation_insight(
    observations: Iterable[UtteranceObservation],
) -> ParticipationInsight:
    window = select_analysis_window(observations)
    observation_count = len(window)
    if observation_count == 0:
        return ParticipationInsight(
            participation_state="insufficient",
            speaker_shares=(),
            data_sufficiency="none",
            judgability="unjudgable",
            reason_code="insufficient_utterances",
            evidence_from=None,
            evidence_to=None,
            observation_count=0,
            analysis_version=ANALYSIS_VERSION,
        )

    counts = Counter(item.speaker_label for item in window)
    shares = tuple(
        SpeakerShare(
            speaker_label=speaker_label,
            ratio=count / observation_count,
            utterance_count=count,
        )
        for speaker_label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    )

    if observation_count < MIN_JUDGABLE_OBSERVATIONS:
        state = "insufficient"
        sufficiency = "insufficient"
        judgability = "unjudgable"
        reason_code = "insufficient_utterances"
    else:
        largest_share = shares[0].ratio
        sufficiency = "sufficient"
        if largest_share <= BALANCED_MAX_SHARE:
            state = "balanced"
            judgability = "judgable"
            reason_code = None
        elif largest_share >= SKEWED_MIN_SHARE:
            state = "skewed"
            judgability = "judgable"
            reason_code = None
        else:
            state = "unknown"
            judgability = "unjudgable"
            reason_code = "borderline_distribution"

    return ParticipationInsight(
        participation_state=state,
        speaker_shares=shares,
        data_sufficiency=sufficiency,
        judgability=judgability,
        reason_code=reason_code,
        evidence_from=window[0].spoken_at,
        evidence_to=window[-1].spoken_at,
        observation_count=observation_count,
        analysis_version=ANALYSIS_VERSION,
    )
