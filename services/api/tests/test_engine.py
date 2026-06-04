from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.domain import Candidate, Coordinates, ItineraryInput
from app.engine import (
    candidate_score,
    estimate_travel_minutes,
    generate_itineraries,
    weather_fit,
)
from app.fixtures import fixture_candidates, fixture_weather


def request(**overrides) -> ItineraryInput:
    values = {
        "location_label": "Upper West Side",
        "coordinates": Coordinates(40.7870, -73.9754),
        "start_at": datetime.now(ZoneInfo("America/New_York")).replace(second=0, microsecond=0),
        "available_minutes": 240,
        "budget_min": 0,
        "budget_max": 40,
        "group_size": 2,
        "transport_mode": "walk",
        "radius_miles": 2.0,
        "mood": "social",
        "regeneration_seed": 0,
    }
    values.update(overrides)
    return ItineraryInput(**values)


def test_mode_aware_travel_estimates_are_ordered():
    assert estimate_travel_minutes(1.0, "bike") < estimate_travel_minutes(1.0, "transit")
    assert estimate_travel_minutes(1.0, "transit") < estimate_travel_minutes(1.0, "walk")


def test_mood_fit_changes_score():
    base = request()
    candidates = fixture_candidates(base)
    social = next(item for item in candidates if item.id == "fixture-trivia")
    quiet = next(item for item in candidates if item.id == "fixture-roerich")
    assert candidate_score(social, base, fixture_weather()) > candidate_score(
        quiet, base, fixture_weather()
    )


def test_group_size_slightly_favors_group_friendly_categories():
    small_group = request(group_size=2, mood="cultural")
    large_group = request(group_size=8, mood="cultural")
    candidates = fixture_candidates(small_group)
    bookstore = next(item for item in candidates if item.id == "fixture-book-culture")
    assert candidate_score(bookstore, small_group, fixture_weather()) > candidate_score(
        bookstore, large_group, fixture_weather()
    )


def test_rain_favors_indoor_candidates():
    base = request()
    candidates = fixture_candidates(base)
    indoor = next(item for item in candidates if item.id == "fixture-roerich")
    outdoor = next(item for item in candidates if item.id == "fixture-riverside")
    assert weather_fit(indoor, fixture_weather("rain")) > weather_fit(
        outdoor, fixture_weather("rain")
    )


def test_generated_plans_respect_time_budget_and_diversity():
    base = request()
    result = generate_itineraries(base, fixture_candidates(base), fixture_weather())
    assert 1 <= len(result.plans) <= 3
    for plan in result.plans:
        assert plan.total_minutes <= base.available_minutes
        assert plan.total_cost_high <= base.budget_max
        assert plan.steps
    for left_index, left in enumerate(result.plans):
        for right in result.plans[left_index + 1 :]:
            left_ids = {step.candidate_id for step in left.steps}
            right_ids = {step.candidate_id for step in right.steps}
            assert len(left_ids & right_ids) <= 1


def test_rain_excludes_outdoor_only_plan():
    base = request(mood="outdoors")
    result = generate_itineraries(base, fixture_candidates(base), fixture_weather("rain"))
    assert all(step.candidate_id != "fixture-riverside" for plan in result.plans for step in plan.steps)


def test_impossible_candidates_do_not_force_a_plan():
    base = request(budget_max=5, available_minutes=60, radius_miles=0.25)
    far_expensive = Candidate(
        id="nope",
        name="Impossible",
        category="event",
        mood_tags=("social",),
        coordinates=Coordinates(40.72, -73.99),
        duration_minutes=120,
        cost_low=50,
        cost_high=70,
        indoor=True,
        source_name="Test",
        source_url=None,
        confidence=1,
        start_at=base.start_at + timedelta(minutes=90),
    )
    result = generate_itineraries(base, [far_expensive], fixture_weather())
    assert result.plans == ()


def test_known_closed_hours_are_rejected():
    base = request()
    start = base.start_at
    closed = Candidate(
        id="closed",
        name="Closed gallery",
        category="gallery",
        mood_tags=("cultural",),
        coordinates=Coordinates(40.7871, -73.9755),
        duration_minutes=45,
        cost_low=0,
        cost_high=0,
        indoor=True,
        source_name="Test",
        source_url=None,
        confidence=0.9,
        opening_hours=f"{('Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su')[start.weekday()]} 00:01-00:02",
    )
    result = generate_itineraries(base, [closed], fixture_weather())
    assert result.plans == ()
