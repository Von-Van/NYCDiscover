"""A conservative reader for OpenStreetMap opening_hours strings."""
import re
from datetime import datetime, timedelta


def known_open_during(opening_hours: str | None, start: datetime, end: datetime) -> bool:
    if not opening_hours:
        return True
    if opening_hours.strip() == "24/7":
        return True
    days = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")
    parsed = []
    day_pattern = r"(?:Mo|Tu|We|Th|Fr|Sa|Su)"
    selector = rf"{day_pattern}(?:-{day_pattern})?(?:,{day_pattern}(?:-{day_pattern})?)*"
    for segment in opening_hours.split(";"):
        match = re.fullmatch(rf"(?:(?P<days>{selector})\s+)?(?P<hours>off|closed|\d{{2}}:\d{{2}}-\d{{2}}:\d{{2}}(?:,\d{{2}}:\d{{2}}-\d{{2}}:\d{{2}})*)", segment.strip())
        if not match:
            continue
        selected_days = match.group('days')
        selected = {d for d in days if not selected_days or any(
            _day_in_range(d, span.split('-')[0], span.split('-')[-1]) for span in selected_days.split(','))}
        hours = match.group('hours')
        if hours not in {'off', 'closed'}:
            windows = [window for window in hours.split(',') if all(_clock_on_date(start, clock) is not None for clock in window.split('-'))]
            if not windows:
                continue
            hours = ','.join(windows)
        parsed.append((selected, hours))
    if not parsed:
        return True  # Unsupported syntax stays explicitly unconfirmed in provider notes.
    if any(days[start.weekday()] in selected and hours in {'off', 'closed'} for selected, hours in parsed):
        return False
    for reference in (start, start - timedelta(days=1)):
        for selected, hours in parsed:
            if days[reference.weekday()] not in selected or hours in {'off', 'closed'}:
                continue
            for window in hours.split(','):
                open_time, close_time = window.split('-')
                opened, closed = _clock_on_date(reference, open_time), _clock_on_date(reference, close_time)
                if opened is None or closed is None:
                    continue
                if closed <= opened:
                    closed += timedelta(days=1)
                if opened.timestamp() <= start.timestamp() and end.timestamp() <= closed.timestamp():
                    return True
    return False


def _clock_on_date(reference: datetime, clock: str) -> datetime | None:
    hour, minute = (int(part) for part in clock.split(":"))
    if minute > 59 or hour > 24 or (hour == 24 and minute != 0):
        return None
    if hour == 24:
        midnight = reference.replace(hour=0, minute=0, second=0, microsecond=0)
        return midnight + timedelta(days=1)
    return reference.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _day_in_range(day: str, first: str, last: str) -> bool:
    days = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")
    start_index, end_index, day_index = days.index(first), days.index(last), days.index(day)
    if start_index <= end_index:
        return start_index <= day_index <= end_index
    return day_index >= start_index or day_index <= end_index
