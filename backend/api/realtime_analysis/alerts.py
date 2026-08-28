from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Literal

ParticipationAlertStatus = Literal["NORMAL", "PENDING", "ACTIVE"]

ACTIVATE_BELOW = 0.5
ACTIVATE_DURATION = timedelta(seconds=120)
RECOVER_AT_OR_ABOVE = 0.6
RECOVER_DURATION = timedelta(seconds=30)
COOLDOWN_DURATION = timedelta(seconds=60)


@dataclass(frozen=True, slots=True)
class ParticipationAlertState:
    status: ParticipationAlertStatus
    pending_since: datetime | None = None
    active_since: datetime | None = None
    recovery_since: datetime | None = None
    cooldown_until: datetime | None = None
    last_observed_at: datetime | None = None

    @classmethod
    def initial(cls) -> "ParticipationAlertState":
        return cls(status="NORMAL")


def advance_participation_alert(
    state: ParticipationAlertState,
    *,
    equity: float,
    observed_at: datetime,
) -> ParticipationAlertState:
    if not 0 <= equity <= 1:
        raise ValueError("participation equity must be between 0 and 1")
    if observed_at.tzinfo is None or observed_at.utcoffset() is None:
        raise ValueError("observed_at must include a timezone")
    if state.last_observed_at is not None and observed_at <= state.last_observed_at:
        return state

    if state.status == "NORMAL":
        if state.cooldown_until is not None and observed_at < state.cooldown_until:
            return replace(state, last_observed_at=observed_at)
        if equity < ACTIVATE_BELOW:
            return ParticipationAlertState(
                status="PENDING",
                pending_since=observed_at,
                last_observed_at=observed_at,
            )
        return ParticipationAlertState(status="NORMAL", last_observed_at=observed_at)

    if state.status == "PENDING":
        if equity >= ACTIVATE_BELOW:
            return ParticipationAlertState(status="NORMAL", last_observed_at=observed_at)
        pending_since = state.pending_since or observed_at
        if observed_at - pending_since >= ACTIVATE_DURATION:
            return ParticipationAlertState(
                status="ACTIVE",
                active_since=observed_at,
                last_observed_at=observed_at,
            )
        return replace(state, pending_since=pending_since, last_observed_at=observed_at)

    if equity >= RECOVER_AT_OR_ABOVE:
        recovery_since = state.recovery_since or observed_at
        if observed_at - recovery_since >= RECOVER_DURATION:
            return ParticipationAlertState(
                status="NORMAL",
                cooldown_until=observed_at + COOLDOWN_DURATION,
                last_observed_at=observed_at,
            )
        return replace(state, recovery_since=recovery_since, last_observed_at=observed_at)

    return replace(state, recovery_since=None, last_observed_at=observed_at)
