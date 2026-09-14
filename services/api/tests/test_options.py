from dataclasses import replace
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.domain import Candidate, Coordinates, ItineraryInput
from app.engine import (
    FOOD_DRINK_CATEGORIES,
    _beam_to_plan,
    _rebuild_route,
    apply_option,
    generate_itineraries,
    with_additional_options,
)
from app.fixtures import fixture_weather


def brief(**overrides):
    values = dict(
        location_label="Upper West Side",
        coordinates=Coordinates(40.787, -73.9754),
        start_at=datetime(2026, 9, 5, 15, 0, tzinfo=ZoneInfo("America/New_York")),
        available_minutes=180, budget_min=0, budget_max=40, group_size=2,
        transport_mode="walk", radius_miles=2, mood="social", moods=("social",),
    )
    return ItineraryInput(**{**values, **overrides})


def candidate(id, category="gallery", **overrides):
    values = dict(
        id=id, name=id.title(), category=category, mood_tags=("social", "food-focused"),
        coordinates=Coordinates(40.7871, -73.9755), duration_minutes=20,
        cost_low=0, cost_high=0, indoor=True, source_name="Test", source_url=None,
        confidence=0.9,
    )
    return Candidate(**{**values, **overrides})


def plan(request, candidates, index=0):
    beam = _rebuild_route(request, candidates, fixture_weather())
    assert beam is not None
    return _beam_to_plan(beam, request, index)


@pytest.mark.parametrize("moods", [("social",), ("food-focused", "social"), ("cultural", "food-focused")])
def test_generation_caps_food_and_drink_across_categories(moods):
    request = brief(mood=moods[0], moods=moods)
    foods = [candidate(category, category) for category in FOOD_DRINK_CATEGORIES]
    result = generate_itineraries(request, foods + [candidate("gallery"), candidate("library", "library")], fixture_weather())
    assert result.plans
    for item in result.plans:
        assert sum(step.category in FOOD_DRINK_CATEGORIES for step in item.steps) <= 1
    # Each comparison itinerary may still contain its own meal.
    assert sum(any(step.category in FOOD_DRINK_CATEGORIES for step in item.steps) for item in result.plans) > 1


@pytest.mark.parametrize("moods", [("food-focused",), ()])
def test_only_food_focused_allows_multiple_food_stops_including_legacy_briefs(moods):
    request = brief(mood="food-focused", moods=moods)
    foods = [candidate(category, category) for category in FOOD_DRINK_CATEGORIES]
    result = generate_itineraries(request, foods, fixture_weather())
    assert len(result.plans[0].steps) == 3


def test_sparse_food_only_catalog_returns_one_stop_without_relaxing_cap():
    request = brief()
    foods = [candidate(category, category) for category in FOOD_DRINK_CATEGORIES]
    result = generate_itineraries(request, foods, fixture_weather())
    assert len(result.plans) == 3
    assert all(len(item.steps) == 1 for item in result.plans)


def test_options_exclude_selected_candidates_and_can_swap_food_for_food():
    request = brief()
    gallery, meal, museum = candidate("gallery"), candidate("meal", "restaurant"), candidate("museum", "museum")
    cafe = candidate("coffee", "cafe")
    context = (gallery, meal, museum, cafe)
    plans = with_additional_options(request, context, fixture_weather(), (plan(request, [gallery, meal]), plan(request, [museum], 1)))
    assert [(item.replaces_candidate_id, item.step.candidate_id) for item in plans[0].additional_options] == [(meal.id, cafe.id)]
    food_brief = brief(mood="food-focused", moods=("food-focused",))
    food_plans = with_additional_options(food_brief, context, fixture_weather(), plans)
    assert len(food_plans[0].additional_options) == 2


@pytest.mark.parametrize("invalid", [
    dict(cost_high=41),
    dict(duration_minutes=180),
    dict(coordinates=Coordinates(40.7, -73.9)),
    dict(opening_hours="Mo-Su 00:00-01:00"),
])
def test_options_reject_replacements_that_break_the_brief(invalid):
    request = brief()
    first, last, bad = candidate("first"), candidate("last", "museum"), candidate("bad", **invalid)
    plans = with_additional_options(request, (first, last, bad), fixture_weather(), (plan(request, [first, last]),))
    assert not plans[0].additional_options


def test_options_validate_downstream_fixed_events_and_opening_hours():
    request = brief()
    first = candidate("first")
    show = candidate("show", "event", start_at=request.start_at + timedelta(minutes=30), duration_minutes=20)
    slow = candidate("slow", duration_minutes=40)
    plans = with_additional_options(request, (first, show, slow), fixture_weather(), (plan(request, [first, show]),))
    assert all(option.replaces_candidate_id != first.id for option in plans[0].additional_options)
    early_close = candidate("closing", opening_hours="Mo-Su 15:00-15:50")
    plans = with_additional_options(request, (first, early_close, slow), fixture_weather(), (plan(request, [first, early_close]),))
    assert all(option.replaces_candidate_id != first.id for option in plans[0].additional_options)


def test_repeat_swaps_rebuild_route_totals_and_make_removed_stops_available():
    request = brief()
    first, last, other = candidate("first"), candidate("last", "museum"), candidate("other", "library")
    meal = candidate("meal", "restaurant", cost_low=8, cost_high=15, duration_minutes=40, confidence=0.7)
    cafe = candidate("cafe", "cafe", cost_low=3, cost_high=6, duration_minutes=30)
    context = (first, last, other, meal, cafe)
    plans = with_additional_options(request, context, fixture_weather(), (plan(request, [first, last]), plan(request, [other], 1)))
    option = next(option for option in plans[0].additional_options if option.replaces_candidate_id == first.id and option.step.candidate_id == meal.id)
    updated = apply_option(request, context, fixture_weather(), plans, plans[0].id, option.id)
    changed = updated[0]
    assert [step.candidate_id for step in changed.steps] == [meal.id, last.id]
    assert changed.steps[1].start_at == request.start_at + timedelta(minutes=44)
    assert changed.steps[1].travel_before.from_label == meal.name
    assert (changed.total_minutes, changed.total_cost_low, changed.total_cost_high, changed.confidence) == (64, 8, 15, 0.8)
    assert changed.title == "Food + Museum"
    assert changed.id == plans[0].id
    assert replace(updated[1], additional_options=()) == replace(plans[1], additional_options=())
    assert any(item.step.candidate_id == first.id for item in changed.additional_options)
    assert all(item.step.candidate_id != meal.id for item in changed.additional_options)
    assert all(item.replaces_candidate_id == meal.id for item in changed.additional_options if item.step.candidate_id == cafe.id)
    # A second swap can affect another stop; this is not a one-change preview.
    next_option = next(item for item in changed.additional_options if item.replaces_candidate_id == last.id and item.step.candidate_id == first.id)
    repeated = apply_option(request, context, fixture_weather(), updated, changed.id, next_option.id)
    assert [step.candidate_id for step in repeated[0].steps] == [meal.id, first.id]
    with pytest.raises(ValueError):
        apply_option(request, context, fixture_weather(), repeated, changed.id, option.id)


def test_rain_and_original_brief_still_apply_to_alternatives():
    request = brief()
    first, park = candidate("first"), candidate("park", "park", indoor=False)
    plans = with_additional_options(request, (first, park), fixture_weather("rain"), (plan(request, [first]),))
    assert not plans[0].additional_options
