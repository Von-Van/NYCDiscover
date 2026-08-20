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
from app.providers import ProviderClient, ProviderHub


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
