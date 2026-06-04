from __future__ import annotations

import asyncio
import hashlib
import json
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from .cache import ProviderCache
from .config import Settings
from .domain import Candidate, Coordinates, ItineraryInput, WeatherContext
from .fixtures import fixture_candidates, fixture_weather


NYC_BOUNDS = {
    "south": 40.4774,
    "north": 40.9176,
    "west": -74.2591,
    "east": -73.7002,
}

CATEGORY_DEFAULTS: dict[str, tuple[int, float, float, bool | None, tuple[str, ...]]] = {
    "restaurant": (65, 16, 32, True, ("food-focused", "social", "date-night")),
    "bar": (70, 12, 28, True, ("social", "date-night", "chaotic")),
    "cafe": (45, 5, 14, True, ("productive", "relaxing", "low-energy")),
    "museum": (75, 0, 25, True, ("cultural", "relaxing", "low-energy")),
    "gallery": (50, 0, 15, True, ("cultural", "relaxing", "date-night")),
    "library": (55, 0, 0, True, ("productive", "cultural", "low-energy")),
    "park": (55, 0, 0, False, ("outdoors", "relaxing", "date-night")),
    "bookstore": (45, 0, 20, True, ("productive", "cultural", "relaxing")),
    "landmark": (45, 0, 10, None, ("cultural", "outdoors", "relaxing")),
    "event": (75, 0, 25, None, ("social", "cultural", "chaotic")),
}


class RateLimiter:
    def __init__(self) -> None:
        self._last_request: dict[str, float] = defaultdict(float)
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def wait(self, provider: str, minimum_interval_seconds: float) -> None:
        async with self._locks[provider]:
            elapsed = time.monotonic() - self._last_request[provider]
            delay = minimum_interval_seconds - elapsed
            if delay > 0:
                await asyncio.sleep(delay)
            self._last_request[provider] = time.monotonic()


class ProviderClient:
    def __init__(self, settings: Settings, cache: ProviderCache) -> None:
        self.settings = settings
        self.cache = cache
        self.rate_limiter = RateLimiter()

    async def fetch_json(
        self,
        provider: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        ttl_seconds: int = 900,
        stale_seconds: int = 86400,
        minimum_interval_seconds: float = 0.2,
        method: str = "GET",
        body: bytes | None = None,
    ) -> tuple[dict[str, Any] | list[Any], bool]:
        query = urllib.parse.urlencode(params or {})
        full_url = f"{url}?{query}" if query and method == "GET" else url
        cache_material = f"{method}:{full_url}:{body.decode() if body else ''}"
        cache_key = f"{provider}:{hashlib.sha256(cache_material.encode()).hexdigest()}"
        cached = await self.cache.get(cache_key)
        if cached is not None:
            return cached, False
        await self.rate_limiter.wait(provider, minimum_interval_seconds)
        request_headers = {
            "Accept": "application/json",
            "User-Agent": self.settings.user_agent,
            **(headers or {}),
        }
        request = urllib.request.Request(full_url, data=body, headers=request_headers, method=method)

        def execute() -> dict[str, Any] | list[Any]:
            with urllib.request.urlopen(request, timeout=12) as response:
                return json.loads(response.read().decode("utf-8"))

        try:
            payload = await asyncio.to_thread(execute)
            await self.cache.set(cache_key, payload, ttl_seconds, stale_seconds)
            return payload, False
        except Exception:
            stale = await self.cache.get(cache_key, allow_stale=True)
            if stale is not None:
                return stale, True
            raise


class ProviderHub:
    def __init__(self, settings: Settings, cache: ProviderCache) -> None:
        self.settings = settings
        self.client = ProviderClient(settings, cache)

    async def geocode(self, query: str) -> tuple[list[dict[str, Any]], tuple[str, ...]]:
        if self.settings.fixture_mode:
            return (
                [
                    {
                        "label": f"{query}, New York, NY",
                        "latitude": 40.7870,
                        "longitude": -73.9754,
                    }
                ],
                (),
            )
        payload, stale = await self.client.fetch_json(
            "nominatim",
            self.settings.nominatim_url,
            params={
                "q": f"{query}, New York City, NY",
                "format": "jsonv2",
                "countrycodes": "us",
                "limit": 5,
                "viewbox": "-74.2591,40.9176,-73.7002,40.4774",
                "bounded": 1,
            },
            ttl_seconds=604800,
            stale_seconds=2592000,
            minimum_interval_seconds=1.05,
        )
        results = []
        for item in payload if isinstance(payload, list) else []:
            lat, lon = float(item["lat"]), float(item["lon"])
            if _inside_nyc(lat, lon):
                results.append(
                    {"label": item.get("display_name", query), "latitude": lat, "longitude": lon}
                )
        warnings = ("Geocoder returned cached data.",) if stale else ()
        return results, warnings

    async def weather(self, request: ItineraryInput) -> tuple[WeatherContext, tuple[str, ...]]:
        if self.settings.fixture_mode:
            return fixture_weather(self.settings.fixture_weather), ()
        try:
            latitude = round(request.coordinates.latitude, 3)
            longitude = round(request.coordinates.longitude, 3)
            point, point_stale = await self.client.fetch_json(
                "nws-points",
                f"{self.settings.nws_url}/points/{latitude:.3f},{longitude:.3f}",
                ttl_seconds=86400,
                stale_seconds=604800,
            )
            hourly_url = point["properties"]["forecastHourly"]
            hourly, hourly_stale = await self.client.fetch_json(
                "nws-hourly", hourly_url, ttl_seconds=1800, stale_seconds=21600
            )
            periods = hourly.get("properties", {}).get("periods", [])
            period = min(
                periods,
                key=lambda item: abs(
                    (
                        (_parse_datetime(item.get("startTime")) or request.start_at)
                        - request.start_at
                    ).total_seconds()
                ),
            ) if periods else {}
            probability = period.get("probabilityOfPrecipitation", {}).get("value") or 0
            description = str(period.get("shortForecast", "Weather details unavailable"))
            wet = probability >= 45 or any(
                word in description.lower() for word in ("rain", "shower", "storm", "snow")
            )
            context = WeatherContext(
                summary=description,
                temperature_f=period.get("temperature"),
                precipitation_probability=int(probability),
                is_wet=wet,
                is_severe=any(word in description.lower() for word in ("severe", "thunderstorm")),
            )
            warnings = ("Weather provider returned cached data.",) if point_stale or hourly_stale else ()
            return context, warnings
        except Exception:
            return fixture_weather("clear"), (
                "Live weather is unavailable; using a neutral weather assumption.",
            )

    async def candidates(self, request: ItineraryInput) -> tuple[list[Candidate], tuple[str, ...]]:
        if self.settings.fixture_mode:
            return fixture_candidates(request), ()
        tasks = [self._overpass_candidates(request)]
        if self.settings.nyc_event_calendar_key:
            tasks.append(self._event_candidates(request))
        else:
            tasks.append(
                asyncio.sleep(
                    0,
                    result=(
                        [],
                        ("NYC Event Calendar is disabled until NYC_EVENT_CALENDAR_KEY is set.",),
                    ),
                )
            )
        results = await asyncio.gather(*tasks, return_exceptions=True)
        candidates: list[Candidate] = []
        warnings: list[str] = []
        for result in results:
            if isinstance(result, Exception):
                warnings.append("A live provider failed; remaining sources were used.")
                continue
            items, provider_warnings = result
            candidates.extend(items)
            warnings.extend(provider_warnings)
        return candidates, tuple(dict.fromkeys(warnings))

    async def _overpass_candidates(
        self, request: ItineraryInput
    ) -> tuple[list[Candidate], tuple[str, ...]]:
        radius_meters = int(request.radius_miles * 1609.34)
        # Coarsen the origin before provider requests so cached responses never fingerprint
        # a user's precise starting point.
        lat = round(request.coordinates.latitude, 3)
        lon = round(request.coordinates.longitude, 3)
        query = f"""
        [out:json][timeout:20];
        (
          nwr(around:{radius_meters},{lat},{lon})["amenity"~"restaurant|bar|cafe|library"];
          nwr(around:{radius_meters},{lat},{lon})["tourism"~"museum|gallery|attraction"];
          nwr(around:{radius_meters},{lat},{lon})["leisure"="park"];
          nwr(around:{radius_meters},{lat},{lon})["shop"="books"];
        );
        out center tags 90;
        """
        payload, stale = await self.client.fetch_json(
            "overpass",
            self.settings.overpass_url,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            body=urllib.parse.urlencode({"data": query}).encode(),
            method="POST",
            ttl_seconds=21600,
            stale_seconds=172800,
            minimum_interval_seconds=1.0,
        )
        candidates = []
        for element in payload.get("elements", []) if isinstance(payload, dict) else []:
            tags = element.get("tags", {})
            name = tags.get("name")
            center = element.get("center", element)
            if not name or "lat" not in center or "lon" not in center:
                continue
            category = _category_from_tags(tags)
            duration, cost_low, cost_high, indoor, moods = CATEGORY_DEFAULTS[category]
            notes = ["Cost and duration are category-based estimates."]
            if tags.get("opening_hours"):
                notes.append("Opening hours are provider-supplied; verify before leaving.")
            candidates.append(
                Candidate(
                    id=f"osm-{element.get('type')}-{element.get('id')}",
                    name=name,
                    category=category,
                    mood_tags=moods,
                    coordinates=Coordinates(float(center["lat"]), float(center["lon"])),
                    duration_minutes=duration,
                    cost_low=cost_low,
                    cost_high=cost_high,
                    indoor=indoor,
                    source_name="OpenStreetMap",
                    source_url=f"https://www.openstreetmap.org/{element.get('type')}/{element.get('id')}",
                    confidence=0.68 if tags.get("opening_hours") else 0.58,
                    estimate_notes=tuple(notes),
                    opening_hours=tags.get("opening_hours"),
                )
            )
        warnings = ("OpenStreetMap places were served from stale cache.",) if stale else ()
        return candidates, warnings

    async def _event_candidates(
        self, request: ItineraryInput
    ) -> tuple[list[Candidate], tuple[str, ...]]:
        day = request.start_at.date().isoformat()
        payload, stale = await self.client.fetch_json(
            "nyc-events",
            self.settings.nyc_event_calendar_url,
            params={"startDate": day, "endDate": day},
            headers={"Ocp-Apim-Subscription-Key": self.settings.nyc_event_calendar_key},
            ttl_seconds=1800,
            stale_seconds=43200,
        )
        raw_events = _find_event_list(payload)
        events: list[Candidate] = []
        for raw in raw_events:
            coordinates = _event_coordinates(raw)
            if not coordinates:
                continue
            start_at = _parse_datetime(raw.get("startDate") or raw.get("start") or raw.get("startDateTime"))
            end_at = _parse_datetime(raw.get("endDate") or raw.get("end") or raw.get("endDateTime"))
            name = raw.get("name") or raw.get("title")
            if not name or not start_at:
                continue
            duration = int((end_at - start_at).total_seconds() / 60) if end_at else 75
            events.append(
                Candidate(
                    id=f"nyc-event-{raw.get('id', name)}",
                    name=str(name),
                    category="event",
                    mood_tags=("social", "cultural", "chaotic"),
                    coordinates=coordinates,
                    duration_minutes=max(30, min(duration, 180)),
                    cost_low=0,
                    cost_high=25,
                    indoor=None,
                    source_name="NYC Event Calendar",
                    source_url=raw.get("url") or raw.get("link"),
                    confidence=0.72,
                    start_at=start_at,
                    end_at=end_at,
                    estimate_notes=(
                        "Price is estimated because the event source does not provide a normalized cost.",
                        "Verify event details before leaving.",
                    ),
                )
            )
        warnings = ("NYC events were served from stale cache.",) if stale else ()
        return events, warnings


def _inside_nyc(lat: float, lon: float) -> bool:
    return (
        NYC_BOUNDS["south"] <= lat <= NYC_BOUNDS["north"]
        and NYC_BOUNDS["west"] <= lon <= NYC_BOUNDS["east"]
    )


def _category_from_tags(tags: dict[str, str]) -> str:
    if tags.get("amenity") in {"restaurant", "bar", "cafe", "library"}:
        return tags["amenity"]
    if tags.get("tourism") in {"museum", "gallery"}:
        return tags["tourism"]
    if tags.get("leisure") == "park":
        return "park"
    if tags.get("shop") == "books":
        return "bookstore"
    return "landmark"


def _find_event_list(payload: dict[str, Any] | list[Any]) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    for key in ("items", "events", "results", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _event_coordinates(raw: dict[str, Any]) -> Coordinates | None:
    location = raw.get("location") if isinstance(raw.get("location"), dict) else {}
    latitude = raw.get("latitude") or raw.get("lat") or location.get("latitude") or location.get("lat")
    longitude = (
        raw.get("longitude") or raw.get("lon") or location.get("longitude") or location.get("lon")
    )
    if latitude is None or longitude is None:
        return None
    coords = Coordinates(float(latitude), float(longitude))
    return coords if _inside_nyc(coords.latitude, coords.longitude) else None


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=ZoneInfo("America/New_York"))
        return parsed.astimezone(ZoneInfo("America/New_York"))
    except ValueError:
        return None
