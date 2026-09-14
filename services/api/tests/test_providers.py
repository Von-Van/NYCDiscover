import asyncio
import hashlib
import json
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.cache import MemoryProviderCache
from app.config import Settings
from app.domain import Coordinates, ItineraryInput
from app.providers import EVENT_GEOCODE_BUDGET, ProviderClient, ProviderHub


def test_memory_cache_returns_fresh_and_stale_values():
    async def scenario():
        cache = MemoryProviderCache()
        await cache.set("test", {"ok": True}, ttl_seconds=-1, stale_seconds=60)
        assert await cache.get("test") is None
        assert await cache.get("test", allow_stale=True) == {"ok": True}

    asyncio.run(scenario())


def test_fixture_geocoder_is_deterministic():
    async def scenario():
        cache = MemoryProviderCache()
        hub = ProviderHub(Settings(fixture_mode=True), cache)
        first, _ = await hub.geocode("Upper West Side")
        second, _ = await hub.geocode("Upper West Side")
        assert first == second
        assert first[0]["latitude"] == 40.7870

    asyncio.run(scenario())


def test_provider_uses_stale_cache_during_an_outage(monkeypatch):
    async def scenario():
        cache = MemoryProviderCache()
        client = ProviderClient(Settings(fixture_mode=False), cache)
        url = "https://example.invalid/data"
        digest = hashlib.sha256(f"GET:{url}:".encode()).hexdigest()
        await cache.set(f"test:{digest}", {"cached": True}, ttl_seconds=-1, stale_seconds=60)

        def fail(*args, **kwargs):
            raise OSError("provider unavailable")

        monkeypatch.setattr(urllib.request, "urlopen", fail)
        payload, stale = await client.fetch_json(
            "test", url, minimum_interval_seconds=0, ttl_seconds=1, stale_seconds=60
        )
        assert payload == {"cached": True}
        assert stale is True

    asyncio.run(scenario())


def test_missing_event_key_returns_warning_in_live_mode(monkeypatch):
    async def scenario():
        cache = MemoryProviderCache()
        hub = ProviderHub(Settings(fixture_mode=False, nyc_event_calendar_key=""), cache)

        async def no_places(request):
            return [], ()

        monkeypatch.setattr(hub, "_overpass_candidates", no_places)
        request = ItineraryInput(
            location_label="Upper West Side",
            coordinates=Coordinates(40.787, -73.9754),
            start_at=datetime.now(ZoneInfo("America/New_York")),
            available_minutes=240,
            budget_min=0,
            budget_max=40,
            group_size=2,
            transport_mode="walk",
            radius_miles=2,
            mood="social",
        )
        candidates, warnings = await hub.candidates(request)
        assert candidates == []
        assert any("NYC_EVENT_CALENDAR_KEY" in warning for warning in warnings)

    asyncio.run(scenario())


def test_overpass_uses_a_bounding_box_and_leaves_radius_filtering_to_engine(monkeypatch):
    async def scenario():
        hub = ProviderHub(Settings(fixture_mode=False), MemoryProviderCache())
        captured: dict[str, object] = {}

        async def fetch_json(provider, url, **kwargs):
            captured.update({"provider": provider, "url": url, **kwargs})
            return {"elements": []}, False

        monkeypatch.setattr(hub.client, "fetch_json", fetch_json)
        request = ItineraryInput(
            location_label="Upper West Side",
            coordinates=Coordinates(40.787, -73.9754),
            start_at=datetime.now(ZoneInfo("America/New_York")),
            available_minutes=240,
            budget_min=0,
            budget_max=40,
            group_size=2,
            transport_mode="walk",
            radius_miles=2,
            mood="social",
        )

        await hub._overpass_candidates(request)

        body = urllib.parse.parse_qs(captured["body"].decode())
        query = body["data"][0]
        assert "around:" not in query
        assert query.count("nwr(") == 4
        assert "[timeout:15]" in query
        assert captured["minimum_interval_seconds"] == 1.0

    asyncio.run(scenario())


def test_overpass_uses_the_configured_fallback_after_primary_failure(monkeypatch):
    async def scenario():
        hub = ProviderHub(
            Settings(
                fixture_mode=False,
                overpass_url="https://primary.invalid",
                overpass_fallback_url="https://fallback.example",
            ),
            MemoryProviderCache(),
        )
        attempted: list[str] = []

        async def fetch_json(provider, url, **kwargs):
            attempted.append(url)
            if url == "https://primary.invalid":
                raise TimeoutError("primary timed out")
            return {"elements": []}, False

        monkeypatch.setattr(hub.client, "fetch_json", fetch_json)
        request = ItineraryInput(
            location_label="Upper West Side",
            coordinates=Coordinates(40.787, -73.9754),
            start_at=datetime.now(ZoneInfo("America/New_York")),
            available_minutes=240,
            budget_min=0,
            budget_max=40,
            group_size=2,
            transport_mode="walk",
            radius_miles=2,
            mood="social",
        )

        candidates, warnings = await hub._overpass_candidates(request)

        assert candidates == []
        assert attempted == ["https://primary.invalid", "https://fallback.example"]
        assert warnings == ("OpenStreetMap places used an alternate public endpoint.",)

    asyncio.run(scenario())


def test_event_calendar_contract_uses_documented_query_and_items_payload(monkeypatch):
    async def scenario():
        payload = json.loads(
            (Path(__file__).parent / "fixtures" / "nyc_event_calendar_sanitized.json").read_text()
        )
        hub = ProviderHub(
            Settings(fixture_mode=False, nyc_event_calendar_key="test-key"),
            MemoryProviderCache(),
        )
        captured: dict[str, object] = {}

        async def fetch_json(provider, url, **kwargs):
            captured.update({"provider": provider, "url": url, **kwargs})
            return payload, False

        async def geocode(address):
            captured["event_address"] = address
            return [
                {
                    "label": "Sanitized Manhattan venue, New York, NY",
                    "latitude": 40.7145,
                    "longitude": -74.0060,
                }
            ], ()

        monkeypatch.setattr(hub.client, "fetch_json", fetch_json)
        monkeypatch.setattr(hub, "geocode", geocode)
        request = ItineraryInput(
            location_label="Lower Manhattan",
            coordinates=Coordinates(40.7128, -74.0060),
            start_at=datetime(2026, 8, 19, 18, 0, tzinfo=ZoneInfo("America/New_York")),
            available_minutes=240,
            budget_min=0,
            budget_max=40,
            group_size=2,
            transport_mode="walk",
            radius_miles=2,
            mood="cultural",
        )

        events, warnings = await hub._event_candidates(request)

        assert captured["params"] == {
            "startDate": "08/19/2026 06:00 PM",
            "endDate": "08/19/2026 10:00 PM",
            "sort": "DATE",
        }
        assert captured["headers"] == {"Ocp-Apim-Subscription-Key": "test-key"}
        assert captured["event_address"] == "5 Sanitized Avenue, Manhattan"
        assert warnings == ()
        assert len(events) == 1
        assert events[0].name == "Public Art Workshop"
        assert events[0].duration_minutes == 90
        assert events[0].coordinates == Coordinates(40.7145, -74.0060)

    asyncio.run(scenario())


def test_overpass_marks_branded_locations_as_chains(monkeypatch):
    async def scenario():
        hub = ProviderHub(Settings(fixture_mode=False), MemoryProviderCache())
        elements = [
            {
                "type": "node",
                "id": 1,
                "lat": 40.787,
                "lon": -73.975,
                "tags": {"name": "Starbucks", "amenity": "cafe", "brand": "Starbucks"},
            },
            {
                "type": "node",
                "id": 2,
                "lat": 40.788,
                "lon": -73.976,
                "tags": {
                    "name": "Corner Coffee",
                    "amenity": "cafe",
                    "brand:wikidata": "Q37158",
                },
            },
            {
                "type": "node",
                "id": 3,
                "lat": 40.789,
                "lon": -73.977,
                "tags": {"name": "Hungarian Pastry Shop", "amenity": "cafe"},
            },
        ]

        async def fetch_json(provider, url, **kwargs):
            return {"elements": elements}, False

        monkeypatch.setattr(hub.client, "fetch_json", fetch_json)
        request = ItineraryInput(
            location_label="Upper West Side",
            coordinates=Coordinates(40.787, -73.9754),
            start_at=datetime.now(ZoneInfo("America/New_York")),
            available_minutes=240,
            budget_min=0,
            budget_max=40,
            group_size=2,
            transport_mode="walk",
            radius_miles=2,
            mood="social",
        )

        candidates, _ = await hub._overpass_candidates(request)

        brands = {candidate.name: candidate.brand for candidate in candidates}
        assert brands["Starbucks"] == "Starbucks"
        assert brands["Corner Coffee"] == "Corner Coffee"
        assert brands["Hungarian Pastry Shop"] is None

    asyncio.run(scenario())


def event_request(**overrides) -> ItineraryInput:
    values = {
        "location_label": "Midtown",
        "coordinates": Coordinates(40.7549, -73.9840),
        "start_at": datetime(2026, 8, 19, 18, 0, tzinfo=ZoneInfo("America/New_York")),
        "available_minutes": 240,
        "budget_min": 0,
        "budget_max": 40,
        "group_size": 2,
        "transport_mode": "walk",
        "radius_miles": 5,
        "mood": "social",
    }
    values.update(overrides)
    return ItineraryInput(**values)


def event_hub(monkeypatch, items, geocoder=None):
    """A hub whose event feed returns `items` and whose geocoder is a stub."""
    hub = ProviderHub(
        Settings(fixture_mode=False, nyc_event_calendar_key="test-key"), MemoryProviderCache()
    )
    attempted: list[str] = []

    async def fetch_json(provider, url, **kwargs):
        return {"items": items}, False

    async def geocode(address):
        attempted.append(address)
        if geocoder is None:
            return [], ()
        return geocoder(address)

    monkeypatch.setattr(hub.client, "fetch_json", fetch_json)
    monkeypatch.setattr(hub, "geocode", geocode)
    return hub, attempted


def street_geocoder(address):
    if any(character.isdigit() for character in address):
        return [{"label": address, "latitude": 40.7500, "longitude": -73.9800}], ()
    return [], ()


START = "2026-08-19T19:00:00.000-04:00"


def test_events_without_a_mappable_address_are_ballparked_not_dropped(monkeypatch):
    async def scenario():
        items = [
            {"id": "a", "name": "Garden evening", "startDate": START,
             "address": "Brooklyn Botanic Garden"},
            {"id": "b", "name": "Story hour", "startDate": START,
             "address": "Multiple locations across Queens"},
            {"id": "c", "name": "Poetry night", "startDate": START, "venue": "Astoria Park Lawn"},
        ]
        hub, attempted = event_hub(monkeypatch, items, street_geocoder)

        events, warnings = await hub._event_candidates(event_request())

        assert [event.name for event in events] == [
            "Garden evening",
            "Story hour",
            "Poetry night",
        ]
        assert all(event.location_is_approximate for event in events)
        assert events[0].coordinates == Coordinates(40.6680, -73.9632)
        assert events[1].coordinates == Coordinates(40.7282, -73.7949)
        assert any("approximate neighborhood location" in warning for warning in warnings)
        assert any("Location is approximate" in note for note in events[0].estimate_notes)
        # A ballparked event is less trustworthy than one with a real address.
        assert events[0].confidence < 0.72
        # Vague text is not worth a slow geocode call.
        assert "Multiple locations across Queens" not in attempted

    asyncio.run(scenario())


def test_exactly_located_events_are_not_marked_approximate(monkeypatch):
    async def scenario():
        items = [
            {"id": "a", "name": "Rooftop concert", "startDate": START,
             "latitude": 40.72, "longitude": -73.99},
            {"id": "b", "name": "Workshop", "startDate": START,
             "address": "5 Real Street, Manhattan"},
        ]
        hub, _ = event_hub(monkeypatch, items, street_geocoder)

        events, warnings = await hub._event_candidates(event_request())

        assert len(events) == 2
        assert not any(event.location_is_approximate for event in events)
        assert all(event.confidence == 0.72 for event in events)
        assert warnings == ()

    asyncio.run(scenario())


def test_online_and_placeless_events_are_dropped_rather_than_ballparked(monkeypatch):
    async def scenario():
        items = [
            {"id": "a", "name": "Webinar: budgeting", "startDate": START, "address": "Online only"},
            {"id": "b", "name": "Virtual tour", "startDate": START, "address": "Zoom"},
            {"id": "c", "name": "Mystery meetup", "startDate": START, "address": "TBD"},
        ]
        hub, attempted = event_hub(monkeypatch, items, street_geocoder)

        events, warnings = await hub._event_candidates(event_request())

        assert events == []
        assert attempted == []
        assert "Some NYC events could not be mapped and were omitted." in warnings

    asyncio.run(scenario())


def test_events_past_the_geocode_budget_fall_back_to_their_neighborhood(monkeypatch):
    async def scenario():
        items = [
            {
                "id": str(index),
                "name": f"Event {index}",
                "startDate": START,
                "address": f"{index} Distinct Street, Harlem",
            }
            for index in range(1, EVENT_GEOCODE_BUDGET + 3)
        ]
        hub, attempted = event_hub(monkeypatch, items, street_geocoder)

        events, _ = await hub._event_candidates(event_request())

        assert len(attempted) == EVENT_GEOCODE_BUDGET
        # Nothing is lost past the budget; the overflow is ballparked instead.
        assert len(events) == len(items)
        assert [event.location_is_approximate for event in events].count(True) == 2

    asyncio.run(scenario())


def test_events_sharing_an_address_reuse_one_geocode_lookup(monkeypatch):
    async def scenario():
        items = [
            {"id": str(index), "name": f"Set {index}", "startDate": START,
             "address": "11 Shared Avenue, Harlem"}
            for index in range(4)
        ]
        hub, attempted = event_hub(monkeypatch, items, street_geocoder)

        events, _ = await hub._event_candidates(event_request())

        assert len(events) == 4
        assert attempted == ["11 Shared Avenue, Harlem"]

    asyncio.run(scenario())
