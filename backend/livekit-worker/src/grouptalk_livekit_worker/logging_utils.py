import logging

_SENSITIVE_FIELDS = {"audio", "identity", "speaker_id", "speaker_label", "token", "transcript"}


class PiiLogFilter(logging.Filter):
    """Remove LiveKit PII extras and neutralize records carrying sensitive app fields."""

    def filter(self, record: logging.LogRecord) -> bool:
        sensitive_record = False
        for key in tuple(record.__dict__):
            if key.startswith("lk.pii.") or key in _SENSITIVE_FIELDS:
                record.__dict__.pop(key, None)
                sensitive_record = True
        if sensitive_record:
            record.msg = "worker_sensitive_log_redacted"
            record.args = ()
        return True


_PII_LOG_FILTER = PiiLogFilter()


def install_pii_log_filter() -> PiiLogFilter:
    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        if _PII_LOG_FILTER not in handler.filters:
            handler.addFilter(_PII_LOG_FILTER)
    return _PII_LOG_FILTER
