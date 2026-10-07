"""Translate the signed generation contract into the planner's domain objects."""

from dataclasses import asdict

from pydantic import TypeAdapter

from .domain import Candidate, Coordinates, ItineraryInput, ItineraryPlan, TimelineStep, WeatherContext
from .engine import apply_option
from .schemas import ApplyOptionRequest, GenerateRequest, GenerationResponse, TimelineStepResponse
from .time_math import NYC


def itinerary_input(payload: GenerateRequest) -> ItineraryInput:
    values = payload.model_dump()
    start = payload.start_at
    values["start_at"] = start.replace(tzinfo=NYC) if start.tzinfo is None else start.astimezone(NYC)
    values["coordinates"] = Coordinates(**values["coordinates"])
    values["moods"] = tuple(values["moods"])
    for key in ("seen_candidate_ids", "visited_candidate_ids", "excluded_candidate_ids", "locked_candidate_ids"):
        values[key] = tuple(values[key])
    return ItineraryInput(**values)


# Pydantic validates the wire models straight into the frozen domain dataclasses,
# turning lists into tuples and nested dicts into their dataclasses.
_candidates = TypeAdapter(tuple[Candidate, ...])
_plans = TypeAdapter(tuple[ItineraryPlan, ...])
_step = TypeAdapter(TimelineStep)
_weather = TypeAdapter(WeatherContext)


def domain_step(payload: TimelineStepResponse) -> TimelineStep:
    return _step.validate_python(payload.model_dump())


def apply_generation_option(payload: ApplyOptionRequest) -> GenerationResponse:
    generation = payload.generation
    if generation.candidate_context is None:
        raise ValueError("Regenerate your plans to get Additional Options.")
    updated = apply_option(
        itinerary_input(payload.brief),
        _candidates.validate_python(generation.model_dump()["candidate_context"]),
        _weather.validate_python(generation.weather.model_dump()),
        _plans.validate_python(generation.model_dump()["plans"]),
        payload.plan_id,
        payload.option_id,
    )
    return GenerationResponse.model_validate({
        **generation.model_dump(),
        "plans": [asdict(plan) for plan in updated],
        "snapshot_token": None,
        "swap_token": None,
    })
