import logging

from grouptalk_livekit_worker.logging_utils import PiiLogFilter


def test_redacts_livekit_and_application_sensitive_log_fields() -> None:
    record = logging.LogRecord(
        name="worker",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="unsafe transcript: %s",
        args=("민감한 전사문",),
        exc_info=None,
    )
    record.__dict__.update(
        {
            "lk.pii.participant_identity": "group-secret",
            "token": "worker-secret",
            "transcript": "민감한 전사문",
            "event_code": "safe_event",
        }
    )

    assert PiiLogFilter().filter(record) is True
    rendered = record.getMessage()

    assert rendered == "worker_sensitive_log_redacted"
    assert "group-secret" not in repr(record.__dict__)
    assert "worker-secret" not in repr(record.__dict__)
    assert "민감한 전사문" not in repr(record.__dict__)
    assert record.__dict__["event_code"] == "safe_event"
