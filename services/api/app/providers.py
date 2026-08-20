from __future__ import annotations

import asyncio
import hashlib
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .cache import ProviderCache
from .config import Settings
from .domain import Candidate, Coordinates, ItineraryInput, WeatherContext
from .fixtures import fixture_candidates, fixture_weather
from .limits import MemoryProviderThrottle, ProviderThrottle


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


class ProviderClient:
    def __init__(
        self,
        settings: Settings,
        cache: ProviderCache,
        throttle: ProviderThrottle | None = None,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.throttle = throttle or MemoryProviderThrottle()

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
        request_timeout_seconds: float = 12,
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
        await self.throttle.wait(provider, minimum_interval_seconds)
        request_headers = {
            "Accept": "application/json",
            "User-Agent": self.settings.user_agent,
            **(headers or {}),
        }
        request = urllib.request.Request(full_url, data=body, headers=request_headers, method=method)

        def execute() -> dict[str, Any] | list[Any]:
            with urllib.request.urlopen(request, timeout=request_timeout_seconds) as response:
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
    def __init__(
        self,
        settings: Settings,
        cache: ProviderCache,
        throttle: ProviderThrottle | None = None,
    ) -> None:
        self.settings = settings
        self.client = ProviderClient(settings, cache, throttle)

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
        # Coarsen the origin before provider requests so cached responses never fingerprint
        # a user's precise starting point.
        lat = round(request.coordinates.latitude, 3)
        lon = round(request.coordinates.longitude, 3)
        latitude_delta = request.radius_miles / 69
        longitude_delta = request.radius_miles / (69 * math.cos(math.radians(lat)))
        bounds = (
            round(lat - latitude_delta, 4),
            round(lon - longitude_delta, 4),
            round(lat + latitude_delta, 4),
            round(lon + longitude_delta, 4),
        )
        bbox = ",".join(str(value) for value in bounds)
        query = f"""
        [out:json][timeout:15];
        (
          nwr({bbox})["amenity"~"restaurant|bar|cafe|library"];
          nwr({bbox})["tourism"~"museum|gallery|attraction"];
          nwr({bbox})["leisure"="park"];
          nwr({bbox})["shop"="books"];
        );
        out center tags 90;
        """
        payload = None
        stale = False
        fallback_used = False
        last_error: Exception | None = None
        endpoints = tuple(
            dict.fromkeys((self.settings.overpass_url, self.settings.overpass_fallback_url))
        )
        for index, endpoint in enumerate(endpoints):
            try:
                payload, stale = await self.client.fetch_json(
                    "overpass",
                    endpoint,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    body=urllib.parse.urlencode({"data": query}).encode(),
                    method="POST",
                    ttl_seconds=21600,
                    stale_seconds=172800,
                    minimum_interval_seconds=1.0,
                    request_timeout_seconds=8 if index == 0 else 14,
                )
                fallback_used = index > 0
                break
            except Exception as exc:
                last_error = exc
        if payload is None:
            raise last_error or RuntimeError("OpenStreetMap places are unavailable")
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
        warnings: list[str] = []
        if stale:
            warnings.append("OpenStreetMap places were served from stale cache.")
        if fallback_used:
            warnings.append("OpenStreetMap places used an alternate public endpoint.")
        return candidates, tuple(warnings)

    async def _event_candidates(
        self, request: ItineraryInput
    ) -> tuple[list[Candidate], tuple[str, ...]]:
        end_at = request.start_at + timedelta(minutes=request.available_minutes)
        event_date_format = "%m/%d/%Y %I:%M %p"
        payload, stale = await self.client.fetch_json(
            "nyc-events",
            self.settings.nyc_event_calendar_url,
            params={
                "startDate": request.start_at.strftime(event_date_format),
                "endDate": end_at.strftime(event_date_format),
                "sort": "DATE",
            },
            headers={"Ocp-Apim-Subscription-Key": self.settings.nyc_event_calendar_key},
            ttl_seconds=1800,
            stale_seconds=43200,
        )
        raw_events = _find_event_list(payload)
        events: list[Candidate] = []
        geocode_attempts = 0
        unmapped_events = 0
        for raw in raw_events:
            start_at = _parse_datetime(raw.get("startDate") or raw.get("start") or raw.get("startDateTime"))
            end_at = _parse_datetime(raw.get("endDate") or raw.get("end") or raw.get("endDateTime"))
            name = raw.get("name") or raw.get("title")
            if not name or not start_at or _event_is_canceled(raw):
                continue
            coordinates = _event_coordinates(raw)
            address = _event_address(raw)
            if (
                not coordinates
                and address
                and _event_address_is_specific(address)
                and geocode_attempts < 6
            ):
                geocode_attempts += 1
                try:
                    matches, _ = await self.geocode(address)
                except Exception:
                    matches = []
                if matches:
                    coordinates = Coordinates(
                        float(matches[0]["latitude"]),
                        float(matches[0]["longitude"]),
                    )
            if not coordinates:
                unmapped_events += 1
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
                    source_url=raw.get("url") or raw.get("link") or raw.get("permalink"),
                    confidence=0.72,
                    start_at=start_at,
                    end_at=end_at,
                    estimate_notes=(
                        "Price is estimated because the event source does not provide a normalized cost.",
                        "Verify event details before leaving.",
                    ),
                )
            )
        warnings: list[str] = []
        if stale:
            warnings.append("NYC events were served from stale cache.")
        if unmapped_events:
            warnings.append("Some NYC events could not be mapped and were omitted.")
        return events, tuple(warnings)


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
    longitude = raw.get("longitude") or raw.get("lon") or raw.get("lng") or location.get(
        "longitude"
    ) or location.get("lon") or location.get("lng")
    if latitude is None or longitude is None:
        return None
    coords = Coordinates(float(latitude), float(longitude))
    return coords if _inside_nyc(coords.latitude, coords.longitude) else None


def _event_address(raw: dict[str, Any]) -> str | None:
    address = raw.get("address")
    if isinstance(address, str):
        return address.strip() or None
    if isinstance(address, list):
        parts = [str(part).strip() for part in address if str(part).strip()]
        return ", ".join(parts) or None
    if isinstance(address, dict):
        parts = [
            str(address[key]).strip()
            for key in ("venue", "address", "street", "city", "state", "zip")
            if address.get(key)
        ]
        return ", ".join(dict.fromkeys(parts)) or None
    return None


def _event_address_is_specific(address: str) -> bool:
    normalized = " ".join(address.lower().split())
    generic_phrases = (
        "check website",
        "locations across",
        "multiple locations",
        "online",
        "various locations",
        "virtual",
        "zoom",
    )
    if any(phrase in normalized for phrase in generic_phrases):
        return False
    return any(character.isdigit() for character in normalized) or any(
        word in normalized
        for word in ("avenue", "center", "museum", "park", "square", "street", "venue")
    )


def _event_is_canceled(raw: dict[str, Any]) -> bool:
    value = raw.get("canceled")
    return value is True or str(value).strip().lower() in {"1", "true", "yes"}


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
