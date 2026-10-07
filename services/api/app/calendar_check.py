"""Read-only check of the configured NYC calendar and five-mile browsing pipeline."""
import asyncio
import json
from collections import Counter
from dataclasses import replace
from datetime import datetime

from .cache import MemoryProviderCache
from .config import settings
from .domain import Coordinates
from .events import event_browsing_input, today_events_response
from .providers import ProviderHub
from .time_math import NYC


async def check():
    if not settings.nyc_event_calendar_key:
        raise SystemExit('NYC_EVENT_CALENDAR_KEY is not configured. Set it in the environment or .env.local.')
    now = datetime.now(NYC)
    origin = Coordinates(40.787, -73.9754)  # A public Upper West Side reference point.
    hub = ProviderHub(replace(settings, fixture_mode=False), MemoryProviderCache())
    raw, warnings = await hub._calendar_events(now)
    candidates, mapped_warnings = await hub.events(event_browsing_input(origin, now))
    result = today_events_response(origin, now, candidates, mapped_warnings, False)
    print(json.dumps(dict(date=now.date().isoformat(), calendar_connection='ok',
        fetched_listings=len(raw), mapped_listings=len(candidates),
        listings_within_five_miles=len(result.events),
        recurrence=dict(Counter(row.event.recurrence for row in result.events)),
        sample_titles=[row.event.name for row in result.events[:3]],
        warnings=list(dict.fromkeys((*warnings, *mapped_warnings)))), indent=2))


if __name__ == '__main__':
    try:
        asyncio.run(check())
    except Exception as exc:
        # Provider exceptions can contain request information. Never print keys or URLs.
        raise SystemExit(f'Calendar check failed ({type(exc).__name__}). Check the configured connection and retry.') from None
