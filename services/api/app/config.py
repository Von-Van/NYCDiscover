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
    database_url: str = os.getenv("DATABASE_URL", "")
    user_agent: str = os.getenv(
        "NYC_DISCOVER_USER_AGENT", "NYCDiscover/0.1 (contact: local-development)"
    )
    nyc_event_calendar_key: str = os.getenv("NYC_EVENT_CALENDAR_KEY", "")
    nyc_event_calendar_url: str = os.getenv(
        "NYC_EVENT_CALENDAR_URL", "https://api.nyc.gov/calendar/search"
    )
    overpass_url: str = os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
    overpass_fallback_url: str = os.getenv(
        "OVERPASS_FALLBACK_URL",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    )
    nominatim_url: str = os.getenv(
        "NOMINATIM_URL", "https://nominatim.openstreetmap.org/search"
    )
    nws_url: str = os.getenv("NWS_URL", "https://api.weather.gov")
    share_signing_secret: str = os.getenv("SHARE_SIGNING_SECRET", "")
    request_hash_secret: str = os.getenv("REQUEST_HASH_SECRET", "")
    sentry_dsn: str = os.getenv("SENTRY_DSN", "")
    sentry_environment: str = os.getenv("SENTRY_ENVIRONMENT", "development")
    vercel_automation_bypass_secret: str = os.getenv(
        "VERCEL_AUTOMATION_BYPASS_SECRET", ""
    )

    def validate_live(self) -> None:
        if self.fixture_mode:
            return
        required = {
            "DATABASE_URL": self.database_url,
            "NYC_EVENT_CALENDAR_KEY": self.nyc_event_calendar_key,
            "SHARE_SIGNING_SECRET": self.share_signing_secret,
            "REQUEST_HASH_SECRET": self.request_hash_secret,
        }
        missing = [name for name, value in required.items() if not value]
        if "local-development" in self.user_agent:
            missing.append("NYC_DISCOVER_USER_AGENT")
        if missing:
            raise RuntimeError(f"Live mode requires: {', '.join(missing)}")


settings = Settings()
