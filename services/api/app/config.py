from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class Settings:
    fixture_mode: bool = _bool("FIXTURE_MODE", True)
    fixture_weather: str = os.getenv("FIXTURE_WEATHER", "clear")
    database_url: str = os.getenv(
        "DATABASE_URL", "postgresql://nycdiscover:nycdiscover@localhost:5432/nycdiscover"
    )
    user_agent: str = os.getenv(
        "NYC_DISCOVER_USER_AGENT", "NYCDiscover/0.1 (contact: local-development)"
    )
    nyc_event_calendar_key: str = os.getenv("NYC_EVENT_CALENDAR_KEY", "")
    nyc_event_calendar_url: str = os.getenv(
        "NYC_EVENT_CALENDAR_URL", "https://api.nyc.gov/calendar/search"
    )
    overpass_url: str = os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
    nominatim_url: str = os.getenv(
        "NOMINATIM_URL", "https://nominatim.openstreetmap.org/search"
    )
    nws_url: str = os.getenv("NWS_URL", "https://api.weather.gov")


settings = Settings()

