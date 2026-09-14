from dataclasses import replace

import pytest

from app.engine import (
    CHAIN_SCORE_MULTIPLIER,
    candidate_score,
    generate_itineraries,
    is_chain_location,
    with_additional_options,
)
from app.fixtures import fixture_weather
from test_options import brief, candidate, plan


@pytest.mark.parametrize("name,brand", [
    ("Starbucks Reserve", None),
    ("Dave's Hot Chicken - Manhattan", None),
    ("Dave’s Hot Chicken", None),
    ("Daves Hot Chicken", None),
    ("Corner Chicken", "Dave’s Hot Chicken"),
    ("Corner Coffee", "Starbucks"),
    ("Coffee and sandwiches", "Starbucks;Subway"),
    ("McDonald's", None),
])
def test_known_major_chains_receive_ranking_penalty(name, brand):
    request = brief()
    local = candidate("local", "restaurant", name="Neighborhood chicken")
    chain = replace(local, id="chain", name=name, brand=brand)
    assert is_chain_location(chain)
    assert candidate_score(chain, request, fixture_weather()) == pytest.approx(
        candidate_score(local, request, fixture_weather()) * CHAIN_SCORE_MULTIPLIER
    )
    assert chain.confidence == local.confidence  # Popularity preference is not data uncertainty.


@pytest.mark.parametrize("name,brand", [
    ("Dallas BBQ - Chelsea", "Dallas BBQ"),
    ("Dallas BBQ", None),
    ("Corner Coffee", "Local NYC Coffee"),
    ("Garden State Diner", "NJ Neighborhood Diners"),
    ("Subway Inn", None),
    ("Peetsville Diner", None),
    ("Dave's Chicken Corner", None),
])
def test_local_and_unknown_brands_keep_normal_ranking(name, brand):
    place = candidate("local", name=name, brand=brand)
    assert not is_chain_location(place)
    assert candidate_score(place, brief(), fixture_weather()) == candidate_score(
        replace(place, name="Independent place", brand=None), brief(), fixture_weather()
    )


def test_chain_preference_applies_to_generated_plans_and_additional_options():
    request = brief(available_minutes=60)
    selected = candidate("selected", "museum", duration_minutes=45)
    local = candidate("local", "restaurant", name="Dallas BBQ", brand="Dallas BBQ", duration_minutes=45)
    chain = replace(local, id="chain", name="Dave's Hot Chicken", brand="Dave's Hot Chicken")
    result = generate_itineraries(request, [chain, local], fixture_weather())
    assert result.plans[0].steps[0].candidate_id == local.id
    assert any(item.steps[0].candidate_id == chain.id for item in result.plans)
    plans = with_additional_options(request, (selected, chain, local), fixture_weather(), (plan(request, [selected]),))
    assert [option.step.candidate_id for option in plans[0].additional_options] == [local.id, chain.id]
    only_chain = generate_itineraries(request, [chain], fixture_weather())
    assert only_chain.plans[0].steps[0].candidate_id == chain.id
