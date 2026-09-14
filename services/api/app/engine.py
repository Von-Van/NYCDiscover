from __future__ import annotations

import hashlib
import json
import math
import random
import re
import unicodedata
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from .domain import (
    AdditionalOption,
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

# Categories that are a happening rather than a place you can walk into any day.
LIVE_CATEGORIES = frozenset({"event", "comedy", "music", "trivia"})
FOOD_DRINK_CATEGORIES = frozenset({"restaurant", "cafe", "dessert", "bar"})


def allows_multiple_food_stops(request: ItineraryInput) -> bool:
    return set(request.moods or (request.mood,)) == {"food-focused"}


# A standing venue is open again tomorrow, so it starts well below anything with
# a fixed start time; a one-day-only happening reaches the top of the range.
EVERGREEN_TIMELINESS = 0.25
UNSCHEDULED_LIVE_TIMELINESS = 0.55
MULTI_DAY_TIMELINESS = 0.70

# Branches of a large chain are ranked below independent neighborhood options.
# The multiplier demotes them rather than removing them, so a chain still
# surfaces when it is genuinely the only thing that fits the brief.
CHAIN_SCORE_MULTIPLIER = 0.65

# Curated major chains only: having a brand tag does not establish a national
# footprint. Unknown brands and NYC/NJ regional businesses keep their normal
# scores. For example Dallas BBQ remains local (dallasbbq.com/reservations),
# whereas Dave's spans many states (store.daveshotchicken.com/location/).
# Normalize punctuation/accents and match whole words for unbranded locations.
CHAIN_NAMES = frozenset(
    {
        # Coffee and bakery
        "starbucks",
        "dunkin",
        "pret a manger",
        "le pain quotidien",
        "gregorys coffee",
        "blue bottle coffee",
        "bluestone lane",
        "joe and the juice",
        "peets coffee",
        "tim hortons",
        "au bon pain",
        "panera bread",
        "krispy kreme",
        "cinnabon",
        "insomnia cookies",
        "crumbl",
        # Fast and fast-casual
        "mcdonalds",
        "burger king",
        "wendys",
        "chipotle",
        "sweetgreen",
        "chopt",
        "just salad",
        "chick fil a",
        "daves hot chicken",
        "popeyes",
        "taco bell",
        "five guys",
        "shake shack",
        "wingstop",
        "panda express",
        "sbarro",
        "potbelly",
        "jersey mikes",
        "white castle",
        "halal guys",
        "dominos",
        "papa johns",
        "pizza hut",
        # Sit-down chains
        "applebees",
        "tgi fridays",
        "olive garden",
        "red lobster",
        "cheesecake factory",
        "buffalo wild wings",
        "hooters",
        "ihop",
        "dennys",
        "outback steakhouse",
        "hard rock cafe",
        "planet hollywood",
        "bubba gump",
        # Dessert
        "baskin robbins",
        "cold stone creamery",
        "haagen dazs",
        "16 handles",
        # Retail
        "barnes and noble",
        "books a million",
    }
)
# Short ambiguous names require an explicit brand match, not a name substring:
# a Subway sandwich franchise counts; the unrelated local Subway Inn does not.
CHAIN_BRANDS = CHAIN_NAMES | {"subway"}


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


def timeliness_fit(candidate: Candidate, request: ItineraryInput) -> float:
    """Rank things happening at a fixed time above places that are open any day."""
    if candidate.start_at is None:
        return (
            UNSCHEDULED_LIVE_TIMELINESS
            if candidate.category in LIVE_CATEGORIES
            else EVERGREEN_TIMELINESS
        )
    finish = candidate.end_at or candidate.start_at + timedelta(
        minutes=candidate.duration_minutes
    )
    run_hours = (finish - candidate.start_at).total_seconds() / 3600
    # A run longer than a day is a standing exhibition, not a one-off happening.
    return 1.0 if run_hours <= 24 else MULTI_DAY_TIMELINESS


def _normalize_place_name(name: str) -> str:
    normalized = name.lower().replace("&", " and ").replace("'", "").replace("’", "")
    decomposed = unicodedata.normalize("NFKD", normalized)
    unaccented = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return " ".join(re.sub(r"[^a-z0-9]+", " ", unaccented).split())


def is_chain_location(candidate: Candidate) -> bool:
    """Known major chain; local and unclassified brands are not penalized."""
    if candidate.brand:
        return any(_normalize_place_name(brand) in CHAIN_BRANDS for brand in candidate.brand.split(";"))
    words = _normalize_place_name(candidate.name).split()
    for chain in CHAIN_NAMES:
        chain_words = chain.split()
        span = len(chain_words)
        if any(
            words[index : index + span] == chain_words
            for index in range(len(words) - span + 1)
        ):
            return True
    return False


def is_live_happening(candidate: Candidate) -> bool:
    return candidate.start_at is not None or candidate.category in LIVE_CATEGORIES


def candidate_score(
    candidate: Candidate,
    request: ItineraryInput,
    weather: WeatherContext,
    origin: Coordinates | None = None,
    used_categories: tuple[str, ...] = (),
) -> float:
    origin = origin or request.coordinates
    distance = haversine_miles(origin, candidate.coordinates)
    selected_moods = request.moods or (request.mood,)
    mood_matches = len(set(selected_moods) & set(candidate.mood_tags))
    mood = 0.30 if mood_matches == 0 else 0.75 + 0.25 * mood_matches / len(selected_moods)
    proximity = max(0.0, 1.0 - (distance / max(request.radius_miles, 0.1)))
    if candidate.location_is_approximate:
        # The distance came from a neighborhood centroid, so it is not precise
        # enough to earn a full proximity bonus (or a full penalty). Shrink it
        # toward neutral so a lucky centroid cannot outrank a verified address.
        proximity = proximity * 0.5 + 0.25
    budget = _budget_fit(candidate, request)
    time_efficiency = min(1.0, candidate.duration_minutes / max(request.available_minutes * 0.35, 1))
    diversity = (1.0 if candidate.category not in used_categories else 0.2) * _group_fit(
        candidate, request.group_size
    )
    score = (
        mood * 0.26
        + timeliness_fit(candidate, request) * 0.18
        + time_efficiency * 0.20
        + proximity * 0.16
        + budget * 0.12
        + weather_fit(candidate, weather) * 0.04
        + diversity * 0.04
    )
    return score * (CHAIN_SCORE_MULTIPLIER if is_chain_location(candidate) else 1.0)


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
        opened = _clock_on_date(start, open_time)
        closed = _clock_on_date(start, close_time)
        if opened is None or closed is None:
            continue
        parsed_any = True
        if first_day and not _day_in_range(day_code, first_day, last_day or first_day):
            continue
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
    live_steps: int = 0


def _extend_beam(
    beam: _Beam,
    candidate: Candidate,
    request: ItineraryInput,
    weather: WeatherContext,
) -> _Beam | None:
    if (
        candidate.category in FOOD_DRINK_CATEGORIES
        and not allows_multiple_food_stops(request)
        and any(step.category in FOOD_DRINK_CATEGORIES for step in beam.steps)
    ):
        return None
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
    if activity_end <= activity_start or activity_end > window_end:
        return None
    if not _known_open_during(candidate.opening_hours, activity_start, activity_end):
        return None
    if beam.total_cost_high + candidate.cost_high > request.budget_max:
        return None
    used_categories = tuple(step.category for step in beam.steps)
    score = candidate_score(candidate, request, weather, beam.current_coordinates, used_categories)
    score -= min(0.18, travel_minutes / max(request.available_minutes, 1) * 0.6)
    # Waiting for a fixed showtime is part of the plan, so it costs less than dead
    # time in front of a place that simply has not opened yet.
    idle_cap, idle_weight = (0.06, 0.35) if candidate.start_at else (0.12, 0.7)
    score -= min(idle_cap, idle_minutes / max(request.available_minutes, 1) * idle_weight)
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
        live_steps=beam.live_steps + (1 if is_live_happening(candidate) else 0),
    )


def _beam_to_plan(beam: _Beam, request: ItineraryInput, index: int) -> ItineraryPlan:
    first_category = CATEGORY_LABELS.get(beam.steps[0].category, beam.steps[0].category.title())
    last_category = CATEGORY_LABELS.get(beam.steps[-1].category, beam.steps[-1].category.title())
    title = first_category if len(beam.steps) == 1 else f"{first_category} + {last_category}"
    selected_moods = request.moods or (request.mood,)
    subtitle = (
        MOOD_LABELS.get(request.mood, "A plan for right now")
        if len(selected_moods) == 1
        else "A blend of " + ", ".join(mood.replace("-", " ") for mood in selected_moods)
    )
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


def _beam_rank(beam: _Beam, request: ItineraryInput) -> float:
    if not beam.steps:
        return 0.0
    active_minutes = sum(
        step.travel_before.minutes
        + int((step.end_at - step.start_at).total_seconds() / 60)
        for step in beam.steps
    )
    return (
        beam.score / len(beam.steps)
        + len(beam.steps) * 0.11
        # Reward a plan built around something live. The bonus saturates at two so
        # a plan still leaves room for food and standing places.
        + min(2, beam.live_steps) * 0.08
        + min(1.0, active_minutes / max(request.available_minutes, 1)) * 0.16
        - beam.idle_minutes / max(request.available_minutes, 1) * 0.25
    )


def _plans_are_too_similar(left: _Beam, right: _Beam) -> bool:
    left_ids = {step.candidate_id for step in left.steps}
    right_ids = {step.candidate_id for step in right.steps}
    smaller_size = min(len(left_ids), len(right_ids))
    shared = len(left_ids & right_ids)
    return shared == smaller_size or shared / smaller_size >= 0.75


def _empty_beam(request: ItineraryInput) -> _Beam:
    return _Beam((), request.start_at, request.coordinates, 0, 0, 0, 0)


def _rebuild_route(
    request: ItineraryInput,
    candidates: list[Candidate],
    weather: WeatherContext,
) -> _Beam | None:
    if not candidates or len({candidate.id for candidate in candidates}) != len(candidates):
        return None
    beam = _empty_beam(request)
    for candidate in candidates:
        if not _candidate_is_possible(candidate, request, weather):
            return None
        extended = _extend_beam(beam, candidate, request, weather)
        if extended is None:
            return None
        beam = extended
    return beam


def _option_id(plan: ItineraryPlan, stop_index: int, candidate: Candidate) -> str:
    material = [plan.id, [step.candidate_id for step in plan.steps], stop_index, candidate.id]
    return hashlib.sha256(json.dumps(material).encode()).hexdigest()[:24]


def with_additional_options(
    request: ItineraryInput,
    candidates: tuple[Candidate, ...],
    weather: WeatherContext,
    plans: tuple[ItineraryPlan, ...],
) -> tuple[ItineraryPlan, ...]:
    """Offer only replacements that can complete the entire ordered itinerary."""
    by_id = {candidate.id: candidate for candidate in candidates}
    selected_ids = {step.candidate_id for plan in plans for step in plan.steps}
    unused = [candidate for candidate in candidates if candidate.id not in selected_ids]
    updated = []
    for plan in plans:
        route = [by_id[step.candidate_id] for step in plan.steps]
        options = []
        for index, step in enumerate(plan.steps):
            ranked = []
            for candidate in unused:
                replacement_route = [*route[:index], candidate, *route[index + 1 :]]
                beam = _rebuild_route(request, replacement_route, weather)
                if beam is None:
                    continue
                preview = _beam_to_plan(beam, request, 0)
                option = AdditionalOption(
                    id=_option_id(plan, index, candidate),
                    replaces_candidate_id=step.candidate_id,
                    step=preview.steps[index],
                    total_minutes=preview.total_minutes,
                    total_cost_low=preview.total_cost_low,
                    total_cost_high=preview.total_cost_high,
                    confidence=preview.confidence,
                )
                ranked.append((_beam_rank(beam, request), candidate.id, option))
            ranked.sort(key=lambda item: (-item[0], item[1]))
            options.extend(item[2] for item in ranked)
        updated.append(replace(plan, additional_options=tuple(options)))
    return tuple(updated)


def apply_option(
    request: ItineraryInput,
    candidates: tuple[Candidate, ...],
    weather: WeatherContext,
    plans: tuple[ItineraryPlan, ...],
    plan_id: str,
    option_id: str,
) -> tuple[ItineraryPlan, ...]:
    plan = next((plan for plan in plans if plan.id == plan_id), None)
    option = next((item for item in plan.additional_options if item.id == option_id), None) if plan else None
    if plan is None or option is None:
        raise ValueError("This option is no longer available. Choose another option or regenerate.")
    by_id = {candidate.id: candidate for candidate in candidates}
    if any(option.step.candidate_id == step.candidate_id for item in plans for step in item.steps):
        raise ValueError("This stop is already in a recommended plan.")
    try:
        route = [
            by_id[option.step.candidate_id if step.candidate_id == option.replaces_candidate_id else step.candidate_id]
            for step in plan.steps
        ]
    except KeyError as exc:
        raise ValueError("The options have expired. Regenerate to continue editing.") from exc
    beam = _rebuild_route(request, route, weather)
    if beam is None:
        raise ValueError("This replacement no longer fits your brief. Choose another option.")
    replacement = replace(_beam_to_plan(beam, request, 0), id=plan.id)
    updated = tuple(replacement if item.id == plan.id else item for item in plans)
    return with_additional_options(request, candidates, weather, updated)


def generate_itineraries(
    request: ItineraryInput,
    candidates: list[Candidate],
    weather: WeatherContext,
    warnings: tuple[str, ...] = (),
) -> GenerationResult:
    rng = random.Random(request.regeneration_seed)
    feasible = list({item.id: item for item in candidates if _candidate_is_possible(item, request, weather)}.values())
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
            key=lambda beam: _beam_rank(beam, request),
            reverse=True,
        )
        beams = next_beams[:48]

    completed.sort(
        key=lambda beam: _beam_rank(beam, request),
        reverse=True,
    )
    selected: list[_Beam] = []
    for beam in completed:
        if any(_plans_are_too_similar(beam, other) for other in selected):
            continue
        selected.append(beam)
        if len(selected) == 3:
            break
    plans = tuple(_beam_to_plan(beam, request, index) for index, beam in enumerate(selected))
    context = tuple(feasible)
    return GenerationResult(
        request=request,
        weather=weather,
        plans=with_additional_options(request, context, weather, plans),
        warnings=warnings,
        candidate_context=context,
    )
