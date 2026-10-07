import asyncio
from dataclasses import replace
from datetime import datetime, timedelta
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo


from app.cache import MemoryProviderCache
from app.config import Settings
from app.domain import Coordinates, PlaceDetails
from app.events import event_browsing_input, today_events_response
from app.main import app
from app.providers import ProviderHub
from helpers import candidate

NYC = ZoneInfo('America/New_York')
NOW = datetime(2026, 9, 30, 13, tzinfo=NYC)
ORIGIN = Coordinates(40.787, -73.9754)


def test_browsing_is_independent_of_plan_constraints_and_preserves_uncertainty():
    expensive = candidate('concert', start_at=NOW+timedelta(hours=7), end_at=NOW+timedelta(hours=9),
        cost_low=120, cost_high=120, coordinates=Coordinates(40.744, -73.98), recurrence='unknown',
        details=PlaceDetails(description='Source description', price_status='verified'))
    nearby = replace(expensive, id='one-off', recurrence='one_off', start_at=NOW+timedelta(hours=1))
    ended = replace(expensive, id='earlier', start_at=NOW-timedelta(hours=3), end_at=NOW-timedelta(hours=2))
    pool = [expensive, nearby, ended, nearby,
        replace(expensive, id='far', coordinates=Coordinates(40.64, -73.95)),
        replace(expensive, id='recurring', recurrence='recurring'),
        replace(expensive, id='tomorrow', start_at=NOW+timedelta(days=1)),
        replace(expensive, id='place', start_at=None)]
    response = today_events_response(ORIGIN, NOW, pool, (), False)
    assert [row.event.id for row in response.events] == ['one-off', 'concert', 'earlier']
    assert response.events[1].distance_miles > 2  # Beyond the default itinerary radius.
    assert response.events[1].event.cost_high == 120
    assert response.events[1].event.recurrence == 'unknown'
    assert response.events[-1].status == 'ended'
    assert response.radius_miles == 5
    assert response.events[1].event.details.description == 'Source description'


def test_browse_uses_new_york_date_when_visitor_is_on_tomorrow():
    tokyo = NOW.astimezone(ZoneInfo('Asia/Tokyo'))
    assert tokyo.date() != NOW.date()
    event = candidate('tonight', start_at=NOW+timedelta(hours=5))
    response = today_events_response(ORIGIN, tokyo, [event], (), False)
    assert response.date == NOW.date()
    assert len(response.events) == 1


def test_calendar_pagination_collects_later_events_and_deduplicates(monkeypatch):
    async def run():
        hub = ProviderHub(Settings(nyc_event_calendar_key='test'), MemoryProviderCache())
        calls = []
        async def fetch(provider, url, **kwargs):
            calls.append(kwargs['params'])
            page = kwargs['params'].get('pageNumber', 1)
            item = {'id': page, 'name': f'Event {page}', 'startDate': '2026-09-30T18:00:00-04:00'}
            return {'items': [item, item], 'pagination': {'numPages': 3, 'currentPage': page}}, False
        monkeypatch.setattr(hub.client, 'fetch_json', fetch)
        events, warnings = await hub._calendar_events(NOW)
        assert [e['id'] for e in events] == [1, 2, 3]
        assert not warnings
        assert calls[-1]['pageNumber'] == 3
        assert all(p['startDate'] == '09/30/2026 12:00 AM' and p['endDate'] == '10/01/2026 12:00 AM' for p in calls)
    asyncio.run(run())


def test_partial_or_stale_calendar_is_never_reported_as_complete(monkeypatch):
    async def run():
        hub = ProviderHub(Settings(), MemoryProviderCache())
        async def fetch(provider, url, **kwargs):
            if kwargs['params'].get('pageNumber') == 2:
                raise TimeoutError()
            return {'items': [{'id': 1}], 'pagination': {'numPages': 2}}, True
        monkeypatch.setattr(hub.client, 'fetch_json', fetch)
        events, warnings = await hub._calendar_events(NOW)
        assert len(events) == 1
        assert any('stale' in w for w in warnings)
        assert any('incomplete' in w for w in warnings)
    asyncio.run(run())


def test_live_calendar_fields_and_cancellations_survive_normalization(monkeypatch):
    async def run():
        hub = ProviderHub(Settings(nyc_event_calendar_key='test', fixture_mode=False), MemoryProviderCache())
        listing = {'id': 'concert', 'name': 'Evening concert', 'startDate': '2026-09-30T20:00:00-04:00',
            'endDate': '2026-09-30T21:00:00-04:00', 'latitude': 40.787, 'longitude': -73.9754,
            'desc': '<p>An evening concert.</p><p>Doors open at 7:30.</p>', 'categories': ['Music'],
            'boroughs': None, 'permalink': 'https://www.nyc.gov/events/concert'}
        monkeypatch.setattr(hub, '_calendar_events', AsyncMock(return_value=([
            listing, {**listing, 'id': 'cancelled', 'canceled': True},
            {**listing, 'id': 'virtual', 'location': 'Online webinar'},
            {**listing, 'id': 'tomorrow', 'startDate': '2026-10-01T01:00:00-04:00'}], ())))
        events, warnings = await hub.events(event_browsing_input(ORIGIN, NOW))
        assert len(events) == 1
        assert events[0].category == 'music'
        assert events[0].details.description == 'An evening concert. Doors open at 7:30.'
        assert events[0].details.price_status == 'unknown'
        assert events[0].recurrence == 'unknown'
        assert events[0].source_url == listing['permalink']
        assert not warnings
    asyncio.run(run())


def test_calendar_api_success_empty_and_unavailable_are_distinct(client, monkeypatch):
    provider = AsyncMock(return_value=([], ()))
    monkeypatch.setattr(app.state.providers, 'events', provider)
    response = client.post('/v1/events/today', json={'coordinates': {'latitude': ORIGIN.latitude, 'longitude': ORIGIN.longitude}})
    assert response.status_code == 200 and response.json()['events'] == []
    assert response.json()['data_mode'] == 'fixture'
    assert provider.call_args.args[0].radius_miles == 5
    provider.side_effect = TimeoutError()
    response = client.post('/v1/events/today', json={'coordinates': {'latitude': ORIGIN.latitude, 'longitude': ORIGIN.longitude}})
    assert response.status_code == 503 and 'unavailable' in response.json()['detail']
    assert client.post('/v1/events/today', json={'coordinates': {'latitude': 0, 'longitude': 0}}).status_code == 422
