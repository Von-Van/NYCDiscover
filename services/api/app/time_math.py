"""Elapsed time arithmetic across New York's daylight-saving transitions."""
from datetime import UTC, datetime, timedelta


def add_minutes(value: datetime, minutes: float) -> datetime:
    return (value.astimezone(UTC) + timedelta(minutes=minutes)).astimezone(value.tzinfo)


def elapsed_minutes(start: datetime, end: datetime) -> int:
    return int((end.timestamp() - start.timestamp()) // 60)


def outing_deadline(start: datetime, minutes: int) -> datetime:
    midnight = (start + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return min(add_minutes(start, minutes), midnight, key=lambda value: value.timestamp())
