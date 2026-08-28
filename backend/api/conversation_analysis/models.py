from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


@dataclass(frozen=True, slots=True)
class AnalysisUtterance:
    id: UUID
    speaker_label: str
    text: str
    spoken_at: datetime


@dataclass(frozen=True, slots=True)
class AnalysisWindow:
    session_id: UUID
    group_id: UUID
    topic: str
    utterances: tuple[AnalysisUtterance, ...]

    @property
    def latest_utterance_id(self) -> UUID:
        return self.utterances[-1].id


class ConversationAnalysisResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic_relevance: Literal["on_topic", "mixed", "off_topic"]
    off_topic_reason: Literal["chitchat", "other"] | None
    off_topic_utterance_ids: list[UUID]
    summary: str = Field(min_length=1, max_length=400)
    keywords: list[str] = Field(min_length=1, max_length=6)
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_topic_evidence(self) -> "ConversationAnalysisResult":
        if self.topic_relevance in {"mixed", "off_topic"}:
            if self.off_topic_reason is None or not self.off_topic_utterance_ids:
                raise ValueError("topic drift requires a reason and evidence")
        elif self.off_topic_reason is not None or self.off_topic_utterance_ids:
            raise ValueError("on-topic analysis must not include drift evidence")
        if len(self.off_topic_utterance_ids) != len(set(self.off_topic_utterance_ids)):
            raise ValueError("off-topic evidence ids must be unique")
        if any(not keyword.strip() for keyword in self.keywords):
            raise ValueError("keywords must not be blank")
        return self
