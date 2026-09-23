"""Reviewed, source-linked neighborhood knowledge. Run with -m app.curated."""
from __future__ import annotations

import json
import re
import sys
from dataclasses import replace
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, HttpUrl, model_validator

from .domain import Candidate, Coordinates, ItineraryInput, PlaceDetails
from .schemas import CoordinatesSchema

CONTENT_PATH = Path(__file__).parent / 'content' / 'places.v1.json'


class MarketSchedule(BaseModel):
    weekdays: list[int] = Field(min_length=1, max_length=7)
    opens: str = Field(pattern=r'^\d{2}:\d{2}$')
    closes: str = Field(pattern=r'^\d{2}:\d{2}$')
    reviewed_at: date
    season_end: date | None = None
    source_url: HttpUrl

    @model_validator(mode='after')
    def valid_window(self):
        for clock in (self.opens, self.closes):
            datetime.strptime(clock, '%H:%M')
        if self.opens >= self.closes or any(d not in range(7) for d in self.weekdays):
            raise ValueError('Market schedules require an ordered same-day window and weekdays 0–6')
        return self


class CuratedPlace(BaseModel):
    id: str = Field(pattern=r'^curated-[a-z0-9-]+$')
    name: str
    borough: Literal['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island']
    neighborhood: str
    address_source: HttpUrl
    coordinates: CoordinatesSchema
    category: Literal['museum', 'library', 'park', 'bookstore', 'restaurant', 'cafe', 'bar', 'market', 'gallery', 'landmark']
    description: str = Field(min_length=10, max_length=300)
    activity: str = Field(min_length=10, max_length=250)
    source_urls: list[HttpUrl] = Field(min_length=1)
    reviewed_at: date
    operations_reviewed_at: date
    cost_low: float = Field(ge=0)
    cost_high: float = Field(ge=0)
    price_status: Literal['free', 'verified', 'estimated', 'unknown']
    opening_hours: str | None = None
    signature: bool = False
    provider_ids: list[str] = Field(default_factory=list)
    prompt: str | None = None
    registration: str | None = None
    schedule: MarketSchedule | None = None
    closed_dates: list[tuple[date, date]] = Field(default_factory=list)
    hours_overrides: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode='after')
    def valid_price(self):
        if self.cost_low > self.cost_high or (self.price_status == 'free' and self.cost_high != 0):
            raise ValueError('Free visits must cost zero; price ranges must be ordered')
        return self


def load_collection() -> list[CuratedPlace]:
    raw = json.loads(CONTENT_PATH.read_text())
    if raw['version'] != 1:
        raise ValueError('Unsupported content version')
    places = [CuratedPlace.model_validate(p) for p in raw['places']]
    if len({p.id for p in places}) != len(places):
        raise ValueError('Duplicate curated ID')
    return places


def review_issues(place: CuratedPlace, today: date) -> list[str]:
    issues = []
    if today > place.reviewed_at + timedelta(days=90):
        issues.append('editorial review overdue')
    if today > place.operations_reviewed_at + timedelta(days=30):
        issues.append('prices and hours need review')
    if place.schedule:
        deadline = min(place.schedule.reviewed_at + timedelta(days=30), place.schedule.season_end or date.max)
        if today > deadline:
            issues.append('recurring schedule needs review')
    return issues


def curated_candidates(request: ItineraryInput) -> list[Candidate]:
    from .providers import CATEGORY_DEFAULTS
    today = request.start_at.date()
    results = []
    for p in load_collection():
        issues = review_issues(p, today)
        if issues or any(first <= today <= last for first, last in p.closed_dates):
            continue
        start = end = None
        if p.schedule:
            if today.weekday() not in p.schedule.weekdays:
                continue
            start = datetime.combine(today, datetime.strptime(p.schedule.opens, '%H:%M').time(), request.start_at.tzinfo)
            end = datetime.combine(today, datetime.strptime(p.schedule.closes, '%H:%M').time(), request.start_at.tzinfo)
        duration, _, _, indoor, moods = CATEGORY_DEFAULTS.get(p.category, (40, 0, 0, False, ('outdoors', 'food-focused', 'social')))
        results.append(Candidate(
            id=p.id, name=p.name, category=p.category, mood_tags=moods,
            coordinates=Coordinates(**p.coordinates.model_dump()), duration_minutes=duration,
            cost_low=p.cost_low, cost_high=p.cost_high, indoor=indoor, source_name='NYC Discover field notes',
            source_url=str(p.source_urls[0]), confidence=0.78, opening_hours=p.hours_overrides.get(today.isoformat(), p.opening_hours),
            start_at=start, end_at=end, schedule_kind='drop_in' if p.schedule else 'opening_hours',
            recurrence='recurring' if p.schedule else 'unknown',
            estimate_notes=('Visit duration is an estimate. Check the linked source for changes to access and hours.',),
            details=PlaceDetails(description=p.description, activity=p.activity, neighborhood=p.neighborhood, borough=p.borough,
                                 price_status=p.price_status, registration=p.registration, source_urls=tuple(str(u) for u in p.source_urls),
                                 reviewed_at=p.reviewed_at.isoformat(), signature=p.signature, prompt=p.prompt),
        ))
    return results


def merge_curated(candidates: list[Candidate], request: ItineraryInput) -> list[Candidate]:
    from .engine import haversine_miles
    records = load_collection()
    normalized = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
    def record_for(c):
        return next((p for p in records if c.id in p.provider_ids or (
            normalized(c.name) == normalized(p.name) and haversine_miles(c.coordinates, Coordinates(**p.coordinates.model_dump())) < 0.12
        )), None)
    # Explicit closures apply to known duplicate provider places as well.
    live = []
    for c in candidates:
        p = record_for(c) if c.start_at is None else None
        if p and any(first <= request.start_at.date() <= last for first, last in p.closed_dates):
            continue
        live.append(c)
    for curated in curated_candidates(request):
        record = next(p for p in records if p.id == curated.id)
        match = next((i for i, c in enumerate(live) if c.start_at is None and (c.id in record.provider_ids or (
            normalized(c.name) == normalized(curated.name) and haversine_miles(c.coordinates, curated.coordinates) < 0.12
        ))), None)
        if match is None:
            live.append(curated)
        else:
            c = live[match]
            # Stable curated identity across provider cache changes; current provider hours take precedence.
            live[match] = replace(curated, opening_hours=record.hours_overrides.get(request.start_at.date().isoformat(), c.opening_hours or curated.opening_hours))
    return live


def main() -> int:
    today = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else datetime.now(ZoneInfo('America/New_York')).date()
    places = load_collection()
    issues = [(p.id, issue) for p in places for issue in review_issues(p, today)]
    print(f'Validated {len(places)} places across {len({p.borough for p in places})} boroughs; review date {today}.')
    for identifier, issue in issues:
        print(f'{identifier}: {issue}')
    return 1 if issues else 0


if __name__ == '__main__':
    raise SystemExit(main())
