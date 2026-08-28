from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

ParticipationState = Literal["balanced", "skewed", "insufficient", "unknown"]
DataSufficiency = Literal["none", "insufficient", "sufficient"]
Judgability = Literal["judgable", "unjudgable"]


@dataclass(frozen=True, slots=True)
class UtteranceObservation:
    id: UUID
    speaker_label: str
    spoken_at: datetime
    created_at: datetime

    def __post_init__(self) -> None:
        if not self.speaker_label.strip():
            raise ValueError("speaker_label must not be blank")
        for field_name, value in (("spoken_at", self.spoken_at), ("created_at", self.created_at)):
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError(f"{field_name} must include a timezone")


@dataclass(frozen=True, slots=True)
class SpeakerShare:
    speaker_label: str
    ratio: float
    utterance_count: int


@dataclass(frozen=True, slots=True)
class ParticipationInsight:
    participation_state: ParticipationState
    speaker_shares: tuple[SpeakerShare, ...]
    data_sufficiency: DataSufficiency
    judgability: Judgability
    reason_code: str | None
    evidence_from: datetime | None
    evidence_to: datetime | None
    observation_count: int
    analysis_version: str
    data_source: Literal["live"] = "live"
