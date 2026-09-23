from collections import Counter
from copy import deepcopy
from dataclasses import asdict, replace
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.curated import curated_candidates, load_collection, merge_curated, review_issues
from app.domain import Coordinates, PlaceDetails, WeatherPeriod
from app.editorial import today_reason
from app.engine import _known_open_during, _rebuild_route, candidate_score, generate_itineraries
from app.fieldguide import discovery_response, remix_inputs, remixed_response
from app.fixtures import fixture_candidates, fixture_weather
from app.options import itinerary_input
from app.providers import _event_price
from app.schemas import CoordinatesSchema, GenerateRequest, GenerationResponse, RemixRequest
from app.time_math import add_minutes, elapsed_minutes, outing_deadline
from test_options import brief, candidate

NYC = ZoneInfo('America/New_York')
TODAY = datetime(2026, 9, 26, 12, tzinfo=NYC)


def test_fixed_start_cannot_be_joined_late_but_market_can_be_visited():
    request = brief(start_at=TODAY)
    market = candidate('market', 'market', start_at=TODAY-timedelta(hours=4),
                       end_at=TODAY+timedelta(hours=1), schedule_kind='drop_in', recurrence='recurring')
    assert _rebuild_route(request, [market], fixture_weather())
    assert not _rebuild_route(request, [replace(market, schedule_kind='fixed_start')], fixture_weather())
    assert not _rebuild_route(request, [replace(market, end_at=TODAY+timedelta(minutes=15))], fixture_weather())
    assert not _rebuild_route(request, [replace(market, end_at=TODAY)], fixture_weather())
    future = replace(market, start_at=TODAY+timedelta(minutes=20), end_at=TODAY+timedelta(minutes=50))
    assert _rebuild_route(request, [future], fixture_weather()).steps[0].start_at == future.start_at


def test_opening_hours_and_final_day_require_evidence():
    request = brief(start_at=TODAY)
    closed = candidate('closed', opening_hours='Mo-Fr 09:00-17:00')
    assert not _rebuild_route(request, [closed], fixture_weather())
    last = candidate('exhibition', final_day=TODAY.date().isoformat(), source_url='https://example.org/exhibition')
    assert today_reason(last, TODAY, TODAY+timedelta(hours=1), fixture_weather()).kind == 'final_day'
    assert today_reason(replace(last, final_day=None), TODAY, TODAY+timedelta(hours=1), fixture_weather()) is None


def test_weather_is_checked_during_each_outdoor_stop_and_claim_needs_full_coverage():
    request = brief(start_at=TODAY, available_minutes=180)
    clear = WeatherPeriod(TODAY, TODAY+timedelta(hours=1), 5)
    storm = WeatherPeriod(TODAY+timedelta(hours=1), TODAY+timedelta(hours=4), 90, True)
    weather = replace(fixture_weather(), periods=(clear, storm))
    park = candidate('park', 'park', indoor=False)
    assert _rebuild_route(request, [park], weather)
    assert not _rebuild_route(replace(request, start_at=TODAY+timedelta(hours=1)), [park], weather)
    assert not _rebuild_route(request, [replace(park, duration_minutes=80)], weather)
    assert today_reason(park, TODAY, TODAY+timedelta(minutes=30), weather).kind == 'weather'
    assert today_reason(park, TODAY+timedelta(hours=5), TODAY+timedelta(hours=6), weather) is None
    assert today_reason(park, TODAY, TODAY+timedelta(minutes=30), replace(weather, assumed=True)) is None


def test_discovery_uses_reachable_fixed_starts_and_verified_free_prices():
    request = brief(start_at=TODAY)
    catalog = [candidate('too-late', start_at=TODAY+timedelta(minutes=1)),
               candidate('soon', start_at=TODAY+timedelta(minutes=30)),
               candidate('unknown', details=PlaceDetails(price_status='unknown')),
               candidate('free', details=PlaceDetails(price_status='free')),
               candidate('detour', details=PlaceDetails(description='A neighborhood sculpture collection.'))]
    cards = discovery_response(request, catalog, fixture_weather(), (), False).cards
    assert len(cards) == len({card.step.candidate_id for card in cards}) == 3
    assert next(c for c in cards if c.label == 'Starting soon').step.candidate_id == 'soon'
    assert next(c for c in cards if c.label == 'Something free').step.candidate_id == 'free'
    ordinary = discovery_response(request, [catalog[2]], fixture_weather(), (), True)
    assert ordinary.cards[0].label == 'Around the neighborhood'
    assert ordinary.data_mode == 'fixture'


def test_unknown_and_conditional_prices_are_not_free():
    assert _event_price({}, 'Free refreshments after the show.') == (0, 25, 'unknown')
    assert _event_price({'cost': 'suggested donation'}, '')[2] == 'unknown'
    assert _event_price({'isFree': True}, '') == (0, 0, 'free')
    assert _event_price({'cost': 12}, '') == (12, 12, 'verified')
    assert _event_price({}, 'This is not a free event.')[2] == 'unknown'


def test_provider_stops_receive_activity_suggestions_without_overwriting_source_details():
    library = candidate('library', 'library', details=PlaceDetails(price_status='free'))
    written = candidate('written', 'bookstore', details=PlaceDetails(
        activity='Browse the upstairs poetry room.', description='A source-backed description.',
        source_urls=('https://example.org/books',)))
    route = _rebuild_route(brief(start_at=TODAY), [library, written], fixture_weather())
    assert route.steps[0].details.activity == 'Find a quiet corner and something new to read.'
    assert route.steps[0].details.price_status == 'free'
    assert route.steps[1].details == written.details
    assert not library.details.activity  # Templates do not modify provider evidence.


def test_curated_coverage_review_expiration_recurrence_and_official_closures():
    places = load_collection()
    assert Counter(p.borough for p in places) == {b: 6 for b in ['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island']}
    assert all(p.source_urls and p.address_source and p.activity for p in places)
    request = brief(start_at=TODAY)
    saturday = curated_candidates(request)
    ids = {c.id for c in saturday}
    assert 'curated-grand-army-market' in ids
    assert 'curated-79th-market' not in ids
    assert 'curated-bronx-museum' not in ids  # Announced September/October closure.
    assert any(c.recurrence == 'recurring' and c.schedule_kind == 'drop_in' for c in saturday)
    market = next(p for p in places if p.schedule)
    assert 'recurring schedule needs review' in review_issues(market, market.schedule.reviewed_at+timedelta(days=31))
    assert 'editorial review overdue' in review_issues(places[0], places[0].reviewed_at+timedelta(days=91))
    assert not curated_candidates(replace(request, start_at=TODAY+timedelta(days=100)))


def test_duplicate_provider_identity_merges_editorial_and_live_hours(monkeypatch):
    record = load_collection()[0].model_copy(update={'provider_ids': ['osm-123']})
    monkeypatch.setattr('app.curated.load_collection', lambda: [record])
    live = candidate('osm-123', name='Different provider spelling', opening_hours='24/7')
    merged = merge_curated([live], brief(start_at=TODAY))
    assert len(merged) == 1 and merged[0].id == record.id
    assert merged[0].opening_hours == '24/7'
    assert merged[0].details.description == record.description


@pytest.mark.parametrize('coordinates', [Coordinates(40.787,-73.9754), Coordinates(40.672,-73.969),
    Coordinates(40.764,-73.923), Coordinates(40.862,-73.897), Coordinates(40.643,-74.077)])
def test_all_borough_fixture_catalogs_have_local_candidates(coordinates):
    request = brief(start_at=TODAY, coordinates=coordinates)
    catalog = fixture_candidates(request)
    assert catalog
    assert generate_itineraries(request, catalog, fixture_weather()).plans


@pytest.mark.parametrize('mode', ['easy', 'new', 'surprise'])
def test_centerpieces_locks_exclusions_and_constraints_in_every_mode(mode):
    catalog = [candidate(f'c{i}', category, cost_high=5) for i, category in enumerate(['museum','gallery','park','library','bookstore','cafe'])]
    request = brief(start_at=TODAY, centerpiece_id='c0', locked_candidate_ids=('c1',), excluded_candidate_ids=('c2',), discovery_mode=mode)
    result = generate_itineraries(request, catalog, fixture_weather())
    assert result.plans
    for plan in result.plans:
        ids = {s.candidate_id for s in plan.steps}
        assert {'c0','c1'} <= ids and 'c2' not in ids
        assert plan.total_cost_high <= request.budget_max and plan.total_minutes <= request.available_minutes
    with pytest.raises(ValueError, match='no longer fits'):
        generate_itineraries(request, catalog[1:], fixture_weather())
    with pytest.raises(ValueError, match='cannot fit together'):
        generate_itineraries(replace(request, available_minutes=30), catalog, fixture_weather())


def test_repetition_is_soft_but_dismissals_exclude_and_empty_pools_explain():
    c = candidate('known')
    request = brief(start_at=TODAY)
    seen = replace(request, seen_candidate_ids=('known',))
    assert candidate_score(c, seen, fixture_weather()) < candidate_score(c, request, fixture_weather())
    result = generate_itineraries(seen, [c], fixture_weather())
    assert result.plans and any('No fresh alternatives' in warning for warning in result.warnings)
    assert not generate_itineraries(replace(seen, excluded_candidate_ids=('known',)), [c], fixture_weather()).plans
    catalog = [candidate(f'c{i}', category) for i, category in enumerate(['museum','gallery','library','park','bookstore','cafe'])]
    result = generate_itineraries(request, catalog, fixture_weather())
    combinations = [{s.category for s in plan.steps} for plan in result.plans]
    assert len(combinations) == 3 and len({tuple(sorted(c)) for c in combinations}) == 3


def remix_payload():
    request = brief(start_at=TODAY, budget_max=30)
    catalog = [candidate(f'c{i}', category, cost_high=5) for i, category in enumerate(['museum','gallery','library','park','bookstore','cafe'])]
    result = generate_itineraries(request, catalog, fixture_weather())
    response = GenerationResponse.model_validate(dict(weather=asdict(result.weather), plans=[asdict(p) for p in result.plans],
        warnings=[], generated_at=TODAY, data_mode='fixture'))
    schema = GenerateRequest.model_validate(asdict(request))
    first = response.plans[0].steps[0]
    return RemixRequest(brief=schema, generation=response, swap_token='x'*24, plan_id='plan-1',
        continue_outing=True, completed_candidate_ids=[first.candidate_id]), catalog


def test_remaining_outing_preserves_completed_stops_budget_and_deadline():
    payload, catalog = remix_payload()
    first = payload.generation.plans[0].steps[0]
    now = TODAY+timedelta(minutes=90)
    effective, request, prefix = remix_inputs(payload, now)
    assert request.coordinates.latitude == first.coordinates.latitude
    assert request.available_minutes == 90 and request.budget_max == 25
    assert effective.budget_max == 30 and effective.start_at == TODAY
    result = remixed_response(payload, effective, request, prefix, catalog, fixture_weather(), ())
    for plan in result.generation.plans:
        assert plan.steps[0] == first and plan.total_cost_high <= 30
        assert plan.steps[1].start_at >= now
        assert plan.steps[-1].end_at <= TODAY+timedelta(minutes=180)
        assert not plan.additional_options
    payload.current_coordinates = CoordinatesSchema(latitude=40.79, longitude=-73.98)
    payload.current_location_label = 'New private starting point'
    assert remix_inputs(payload, now)[0].location_label == 'New private starting point'
    with pytest.raises(ValueError, match='no time remaining'):
        remix_inputs(payload, TODAY+timedelta(hours=4))
    payload.completed_candidate_ids.reverse()
    payload.completed_candidate_ids.append('not-in-plan')
    with pytest.raises(ValueError, match='itinerary order'):
        remix_inputs(payload, now)


def test_nyc_midnight_visitors_and_dst_elapsed_time():
    schema = GenerateRequest.model_validate(asdict(brief(start_at=datetime.fromisoformat('2026-09-27T03:30:00+00:00'))))
    assert itinerary_input(schema).start_at.date().isoformat() == '2026-09-26'
    assert outing_deadline(itinerary_input(schema).start_at, 240).hour == 0
    for start in [datetime(2026,3,8,1,30,tzinfo=NYC), datetime(2026,11,1,1,30,tzinfo=NYC)]:
        end = add_minutes(start, 120)
        assert elapsed_minutes(start, end) == 120
        request = brief(start_at=start, available_minutes=120)
        result = generate_itineraries(request, [candidate('one', duration_minutes=90)], fixture_weather())
        assert result.plans[0].total_minutes == 92
    late = brief(start_at=TODAY.replace(hour=23,minute=50))
    assert not generate_itineraries(late, [candidate('long', duration_minutes=30)], fixture_weather()).plans


def test_hours_support_closed_days_split_sessions_and_overnight():
    saturday = TODAY
    assert not _known_open_during('Mo-Su 09:00-18:00; Sa off', saturday, saturday+timedelta(minutes=30))
    assert _known_open_during('Mo,We,Sa 10:00-13:00,14:00-18:00', saturday, saturday+timedelta(minutes=30))
    assert not _known_open_during('Mo,We,Sa 10:00-13:00,14:00-18:00', saturday.replace(hour=13), saturday.replace(hour=14))
    early_saturday = saturday.replace(hour=1)
    assert _known_open_during('Fr 20:00-02:00', early_saturday, early_saturday+timedelta(minutes=30))


def test_second_fall_hour_fixed_event_remains_reachable():
    start = datetime(2026,11,1,1,45,tzinfo=NYC,fold=0)
    show = datetime(2026,11,1,1,15,tzinfo=NYC,fold=1)
    request = brief(start_at=start, available_minutes=120)
    result = generate_itineraries(request, [candidate('show', start_at=show)], fixture_weather())
    assert result.plans and result.plans[0].steps[0].start_at == show
