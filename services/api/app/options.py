"""Translate the signed generation contract into the planner's domain objects."""

from dataclasses import asdict
from zoneinfo import ZoneInfo

from .domain import (
    AdditionalOption,
    Candidate,
    Coordinates,
    ItineraryInput,
    ItineraryPlan,
    TimelineStep,
    TravelLeg,
    WeatherContext,
)
from .engine import apply_option
from .schemas import ApplyOptionRequest, GenerateRequest, GenerationResponse, TimelineStepResponse


def itinerary_input(payload: GenerateRequest) -> ItineraryInput:
    values = payload.model_dump()
    start = payload.start_at
    nyc = ZoneInfo("America/New_York")
    values["start_at"] = start.replace(tzinfo=nyc) if start.tzinfo is None else start.astimezone(nyc)
    values["coordinates"] = Coordinates(**values["coordinates"])
    values["moods"] = tuple(values["moods"])
    return ItineraryInput(**values)


def _step(payload: TimelineStepResponse) -> TimelineStep:
    values = payload.model_dump()
    values["coordinates"] = Coordinates(**values["coordinates"])
    values["travel_before"] = TravelLeg(**values["travel_before"])
    values["estimate_notes"] = tuple(values["estimate_notes"])
    return TimelineStep(**values)


def apply_generation_option(payload: ApplyOptionRequest) -> GenerationResponse:
    generation = payload.generation
    if generation.candidate_context is None:
        raise ValueError("Regenerate your plans to get Additional Options.")
    candidates = []
    for candidate in generation.candidate_context:
        values = candidate.model_dump()
        values["coordinates"] = Coordinates(**values["coordinates"])
        values["mood_tags"] = tuple(values["mood_tags"])
        values["estimate_notes"] = tuple(values["estimate_notes"])
        candidates.append(Candidate(**values))
    plans = []
    for plan in generation.plans:
        values = plan.model_dump(exclude={"steps", "additional_options"})
        values["steps"] = tuple(_step(step) for step in plan.steps)
        values["estimate_notes"] = tuple(values["estimate_notes"])
        values["additional_options"] = tuple(
            AdditionalOption(**option.model_dump(exclude={"step"}), step=_step(option.step))
            for option in plan.additional_options
        )
        plans.append(ItineraryPlan(**values))
    updated = apply_option(
        itinerary_input(payload.brief),
        tuple(candidates),
        WeatherContext(**generation.weather.model_dump()),
        tuple(plans),
        payload.plan_id,
        payload.option_id,
    )
    return GenerationResponse.model_validate({
        **generation.model_dump(),
        "plans": [asdict(plan) for plan in updated],
        "snapshot_token": None,
        "swap_token": None,
    })
