"""A readable calendar alongside a plan, independent of itinerary constraints."""
from dataclasses import asdict
from datetime import datetime
from zoneinfo import ZoneInfo

from .domain import Candidate, Coordinates, ItineraryInput
from .engine import haversine_miles
from .schemas import TodayEvent, TodayEventsResponse


def event_browsing_input(origin: Coordinates, now: datetime) -> ItineraryInput:
    return ItineraryInput(location_label="Event browsing", coordinates=origin,
        start_at=now.astimezone(ZoneInfo("America/New_York")), available_minutes=240,
        budget_min=0, budget_max=500, group_size=1, transport_mode="walk", radius_miles=5, mood="cultural")


def today_events_response(origin: Coordinates, now: datetime, candidates: list[Candidate],
                          warnings: tuple[str, ...], fixture: bool) -> TodayEventsResponse:
    now = now.astimezone(ZoneInfo("America/New_York"))
    events = []
    seen = set()
    for candidate in candidates:
        if not candidate.start_at or candidate.start_at.astimezone(now.tzinfo).date() != now.date():
            continue
        if candidate.recurrence == "recurring":
            continue
        distance = haversine_miles(origin, candidate.coordinates)
        identity = (candidate.id, candidate.start_at.timestamp())
        if distance > 5 or identity in seen:
            continue
        seen.add(identity)
        status = "upcoming" if candidate.start_at.timestamp() > now.timestamp() else (
            "ended" if candidate.end_at and candidate.end_at.timestamp() <= now.timestamp() else "started")
        events.append(TodayEvent(event=asdict(candidate), distance_miles=round(distance, 1), status=status))
    # Keep the whole day readable, with remaining events first and earlier listings last.
    events.sort(key=lambda item: (item.status == "ended", item.event.start_at.timestamp(), item.distance_miles, item.event.id))
    return TodayEventsResponse(date=now.date(), events=events, warnings=list(warnings), generated_at=now,
                               data_mode="fixture" if fixture else "live")
