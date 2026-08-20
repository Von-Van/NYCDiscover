from __future__ import annotations

import math
import random
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from .domain import (
    Candidate,
    Coordinates,
    GenerationResult,
    ItineraryInput,
    ItineraryPlan,
    TimelineStep,
    TravelLeg,
    WeatherContext,
)


MOOD_LABELS = {
    "social": "Easy company",
    "relaxing": "A softer pace",
    "outdoors": "Fresh-air wandering",
    "date-night": "A good little date",
    "productive": "A useful reset",
    "chaotic": "A little plot twist",
    "low-energy": "Low lift, still worth leaving",
    "cultural": "A cultured detour",
    "food-focused": "Built around a good bite",
}

CATEGORY_LABELS = {
    "restaurant": "Food",
    "dessert": "Dessert",
    "cafe": "Cafe",
    "trivia": "Trivia",
    "comedy": "Comedy",
    "music": "Music",
    "museum": "Museum",
    "park": "Park",
    "library": "Library",
    "bookstore": "Bookstore",
    "gallery": "Gallery",
    "landmark": "Landmark",
}


def haversine_miles(a: Coordinates, b: Coordinates) -> float:
    radius = 3958.8
    lat1, lat2 = math.radians(a.latitude), math.radians(b.latitude)
    dlat = math.radians(b.latitude - a.latitude)
    dlon = math.radians(b.longitude - a.longitude)
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def estimate_travel_minutes(distance_miles: float, mode: str) -> int:
    if distance_miles <= 0.05:
        return 2
    speed_mph, buffer_minutes = {
        "walk": (2.9, 2),
        "bike": (9.5, 4),
        "transit": (11.0, 11),
    }.get(mode, (2.9, 2))
    return max(3, math.ceil((distance_miles / speed_mph) * 60 + buffer_minutes))


def weather_fit(candidate: Candidate, weather: WeatherContext) -> float:
    if weather.is_severe and candidate.indoor is False:
        return 0.0
    if weather.is_wet and candidate.indoor is False:
        return 0.15
    if weather.is_wet and candidate.indoor is True:
        return 1.0
    if not weather.is_wet and candidate.indoor is False:
        return 1.0
    return 0.75


def candidate_score(
    candidate: Candidate,
    request: ItineraryInput,
    weather: WeatherContext,
    origin: Coordinates | None = None,
    used_categories: tuple[str, ...] = (),
) -> float:
    origin = origin or request.coordinates
    distance = haversine_miles(origin, candidate.coordinates)
    mood = 1.0 if request.mood in candidate.mood_tags else 0.30
    proximity = max(0.0, 1.0 - (distance / max(request.radius_miles, 0.1)))
    budget = _budget_fit(candidate, request)
    time_efficiency = min(1.0, candidate.duration_minutes / max(request.available_minutes * 0.35, 1))
    diversity = (1.0 if candidate.category not in used_categories else 0.2) * _group_fit(
        candidate, request.group_size
    )
    return (
        mood * 0.30
        + time_efficiency * 0.25
        + proximity * 0.20
        + budget * 0.15
        + weather_fit(candidate, weather) * 0.05
        + diversity * 0.05
    )


def _budget_fit(candidate: Candidate, request: ItineraryInput) -> float:
    midpoint = (candidate.cost_low + candidate.cost_high) / 2
    if request.budget_min <= midpoint <= request.budget_max:
        return 1.0
    if midpoint < request.budget_min:
        return max(0.55, midpoint / max(request.budget_min, 1))
    return max(0.0, request.budget_max / max(candidate.cost_high, 1))


def _group_fit(candidate: Candidate, group_size: int) -> float:
    if group_size <= 2:
        return 1.0
    group_friendly = {"restaurant", "bar", "park", "event", "trivia", "comedy", "music"}
    if group_size <= 5:
        return 1.0 if candidate.category in group_friendly else 0.8
    return 1.0 if candidate.category in group_friendly else 0.55


def _candidate_is_possible(
    candidate: Candidate, request: ItineraryInput, weather: WeatherContext
) -> bool:
    distance = haversine_miles(request.coordinates, candidate.coordinates)
    if distance > request.radius_miles:
        return False
    if candidate.cost_low > request.budget_max:
        return False
    if candidate.duration_minutes > request.available_minutes:
        return False
    if weather.precipitation_probability >= 75 and candidate.indoor is False:
        return False
    window_end = request.start_at + timedelta(minutes=request.available_minutes)
    if candidate.start_at and not (request.start_at <= candidate.start_at <= window_end):
        return False
    if candidate.end_at and candidate.end_at > window_end:
        return False
    estimated_start = candidate.start_at or request.start_at + timedelta(
        minutes=estimate_travel_minutes(distance, request.transport_mode)
    )
    estimated_end = candidate.end_at or estimated_start + timedelta(minutes=candidate.duration_minutes)
    if not _known_open_during(candidate.opening_hours, estimated_start, estimated_end):
        return False
    return True


def _known_open_during(opening_hours: str | None, start: datetime, end: datetime) -> bool:
    if not opening_hours:
        return True
    if opening_hours.strip() == "24/7":
        return True
    day_code = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")[start.weekday()]
    segments = opening_hours.split(";")
    parsed_any = False
    for segment in segments:
        match = re.search(
            r"(?:(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?\s+)?"
            r"(\d{2}:\d{2})-(\d{2}:\d{2})",
            segment.strip(),
        )
        if not match:
            continue
        first_day, last_day, open_time, close_time = match.groups()
        if first_day and not _day_in_range(day_code, first_day, last_day or first_day):
            continue
        opened = _clock_on_date(start, open_time)
        closed = _clock_on_date(start, close_time)
        if opened is None or closed is None:
            continue
        parsed_any = True
        if closed <= opened:
            closed += timedelta(days=1)
        if opened <= start and end <= closed:
            return True
    return True if not parsed_any else False


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


@dataclass(slots=True)
class _Beam:
    steps: tuple[TimelineStep, ...]
    current_time: datetime
    current_coordinates: Coordinates
    total_cost_low: float
    total_cost_high: float
    score: float
    idle_minutes: int


def _extend_beam(
    beam: _Beam,
    candidate: Candidate,
    request: ItineraryInput,
    weather: WeatherContext,
) -> _Beam | None:
    distance = haversine_miles(beam.current_coordinates, candidate.coordinates)
    travel_minutes = estimate_travel_minutes(distance, request.transport_mode)
    arrival = beam.current_time + timedelta(minutes=travel_minutes)
    idle_minutes = 0
    if candidate.start_at:
        if arrival > candidate.start_at:
            return None
        idle_minutes = int((candidate.start_at - arrival).total_seconds() / 60)
        activity_start = candidate.start_at
    else:
        activity_start = arrival
    activity_end = candidate.end_at or activity_start + timedelta(minutes=candidate.duration_minutes)
    window_end = request.start_at + timedelta(minutes=request.available_minutes)
    if activity_end > window_end:
        return None
    if beam.total_cost_high + candidate.cost_high > request.budget_max:
        return None
    used_categories = tuple(step.category for step in beam.steps)
    score = candidate_score(candidate, request, weather, beam.current_coordinates, used_categories)
    score -= min(0.18, travel_minutes / max(request.available_minutes, 1) * 0.6)
    score -= min(0.12, idle_minutes / max(request.available_minutes, 1) * 0.7)
    leg = TravelLeg(
        mode=request.transport_mode,
        minutes=travel_minutes,
        distance_miles=round(distance, 2),
        from_label=beam.steps[-1].name if beam.steps else request.location_label,
        to_label=candidate.name,
    )
    step = TimelineStep(
        candidate_id=candidate.id,
        name=candidate.name,
        category=candidate.category,
        start_at=activity_start,
        end_at=activity_end,
        coordinates=candidate.coordinates,
        cost_low=candidate.cost_low,
        cost_high=candidate.cost_high,
        confidence=candidate.confidence,
        source_name=candidate.source_name,
        source_url=candidate.source_url,
        estimate_notes=candidate.estimate_notes,
        travel_before=leg,
    )
    return _Beam(
        steps=beam.steps + (step,),
        current_time=activity_end,
        current_coordinates=candidate.coordinates,
        total_cost_low=beam.total_cost_low + candidate.cost_low,
        total_cost_high=beam.total_cost_high + candidate.cost_high,
        score=beam.score + score,
        idle_minutes=beam.idle_minutes + idle_minutes,
    )


def _beam_to_plan(beam: _Beam, request: ItineraryInput, index: int) -> ItineraryPlan:
    first_category = CATEGORY_LABELS.get(beam.steps[0].category, beam.steps[0].category.title())
    last_category = CATEGORY_LABELS.get(beam.steps[-1].category, beam.steps[-1].category.title())
    title = first_category if len(beam.steps) == 1 else f"{first_category} + {last_category}"
    subtitle = MOOD_LABELS.get(request.mood, "A plan for right now")
    confidence = sum(step.confidence for step in beam.steps) / len(beam.steps)
    confidence -= min(0.12, beam.idle_minutes / max(request.available_minutes, 1))
    total_minutes = int((beam.current_time - request.start_at).total_seconds() / 60)
    notes = {
        "Travel times are mode-aware estimates, not turn-by-turn routes.",
        "Costs are estimated per person.",
    }
    for step in beam.steps:
        notes.update(step.estimate_notes)
    return ItineraryPlan(
        id=f"plan-{index + 1}",
        title=title,
        subtitle=subtitle,
        score=round(beam.score / len(beam.steps), 3),
        confidence=round(max(0.0, min(1.0, confidence)), 2),
        total_minutes=total_minutes,
        total_cost_low=round(beam.total_cost_low, 2),
        total_cost_high=round(beam.total_cost_high, 2),
        steps=beam.steps,
        estimate_notes=tuple(sorted(notes)),
    )


def generate_itineraries(
    request: ItineraryInput,
    candidates: list[Candidate],
    weather: WeatherContext,
    warnings: tuple[str, ...] = (),
) -> GenerationResult:
    rng = random.Random(request.regeneration_seed)
    feasible = [item for item in candidates if _candidate_is_possible(item, request, weather)]
    rng.shuffle(feasible)
    feasible.sort(
        key=lambda item: candidate_score(item, request, weather)
        + rng.uniform(0, 0.035),
        reverse=True,
    )
    beams = [
        _Beam(
            steps=(),
            current_time=request.start_at,
            current_coordinates=request.coordinates,
            total_cost_low=0,
            total_cost_high=0,
            score=0,
            idle_minutes=0,
        )
    ]
    completed: list[_Beam] = []
    for _ in range(3):
        next_beams: list[_Beam] = []
        for beam in beams:
            used_ids = {step.candidate_id for step in beam.steps}
            for candidate in feasible:
                if candidate.id in used_ids:
                    continue
                extended = _extend_beam(beam, candidate, request, weather)
                if extended:
                    next_beams.append(extended)
                    completed.append(extended)
        if not next_beams:
            break
        next_beams.sort(
            key=lambda beam: beam.score
            + len(beam.steps) * 0.08
            - beam.idle_minutes / max(request.available_minutes, 1),
            reverse=True,
        )
        beams = next_beams[:18]

    completed.sort(
        key=lambda beam: beam.score / len(beam.steps) + min(len(beam.steps), 2) * 0.05,
        reverse=True,
    )
    selected: list[_Beam] = []
    for beam in completed:
        ids = {step.candidate_id for step in beam.steps}
        if any(len(ids & {step.candidate_id for step in other.steps}) > 1 for other in selected):
            continue
        selected.append(beam)
        if len(selected) == 3:
            break
    plans = tuple(_beam_to_plan(beam, request, index) for index, beam in enumerate(selected))
    return GenerationResult(request=request, weather=weather, plans=plans, warnings=warnings)
