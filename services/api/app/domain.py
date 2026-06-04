from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime


@dataclass(frozen=True, slots=True)
class Coordinates:
    latitude: float
    longitude: float


@dataclass(frozen=True, slots=True)
class Candidate:
    id: str
    name: str
    category: str
    mood_tags: tuple[str, ...]
    coordinates: Coordinates
    duration_minutes: int
    cost_low: float
    cost_high: float
    indoor: bool | None
    source_name: str
    source_url: str | None
    confidence: float
    start_at: datetime | None = None
    end_at: datetime | None = None
    estimate_notes: tuple[str, ...] = ()
    popularity: float | None = None
    opening_hours: str | None = None


@dataclass(frozen=True, slots=True)
class WeatherContext:
    summary: str
    temperature_f: int | None
    precipitation_probability: int
    is_wet: bool
    is_severe: bool = False
    source_name: str = "National Weather Service"


@dataclass(frozen=True, slots=True)
class ItineraryInput:
    location_label: str
    coordinates: Coordinates
    start_at: datetime
    available_minutes: int
    budget_min: float
    budget_max: float
    group_size: int
    transport_mode: str
    radius_miles: float
    mood: str
    regeneration_seed: int = 0


@dataclass(frozen=True, slots=True)
class TravelLeg:
    mode: str
    minutes: int
    distance_miles: float
    from_label: str
    to_label: str
    estimate_note: str = "Mode-aware estimate; verify before leaving."


@dataclass(frozen=True, slots=True)
class TimelineStep:
    candidate_id: str
    name: str
    category: str
    start_at: datetime
    end_at: datetime
    coordinates: Coordinates
    cost_low: float
    cost_high: float
    confidence: float
    source_name: str
    source_url: str | None
    estimate_notes: tuple[str, ...]
    travel_before: TravelLeg


@dataclass(frozen=True, slots=True)
class ItineraryPlan:
    id: str
    title: str
    subtitle: str
    score: float
    confidence: float
    total_minutes: int
    total_cost_low: float
    total_cost_high: float
    steps: tuple[TimelineStep, ...]
    estimate_notes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class GenerationResult:
    request: ItineraryInput
    weather: WeatherContext
    plans: tuple[ItineraryPlan, ...]
    warnings: tuple[str, ...] = ()
    generated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
