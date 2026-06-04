import asyncio
import hashlib
import urllib.request
from datetime import datetime
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
