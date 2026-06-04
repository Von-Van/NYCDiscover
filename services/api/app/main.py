from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from .cache import build_cache
from .config import settings
from .domain import Coordinates, ItineraryInput
from .engine import generate_itineraries
from .providers import ProviderHub
from .schemas import (
    GenerateRequest,
    GenerationResponse,
    GeocodeResponse,
    HealthResponse,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    cache = await build_cache(settings.database_url, settings.fixture_mode)
    app.state.cache = cache
    app.state.providers = ProviderHub(settings, cache)
    yield
    await cache.close()


app = FastAPI(
    title="NYC Discover API",
    version="0.1.0",
    description="Same-day, constraint-aware NYC itinerary generation.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    return HealthResponse(
        status="ok",
        database=request.app.state.cache.status,
        fixture_mode=settings.fixture_mode,
    )


@app.get("/v1/geocode", response_model=GeocodeResponse)
async def geocode(
    request: Request, q: str = Query(min_length=3, max_length=120)
) -> GeocodeResponse:
    try:
        results, warnings = await request.app.state.providers.geocode(q.strip())
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Geocoding is temporarily unavailable.") from exc
    return GeocodeResponse(results=results, warnings=list(warnings))


@app.post("/v1/itineraries/generate", response_model=GenerationResponse)
async def generate(payload: GenerateRequest, request: Request) -> GenerationResponse:
    nyc_tz = ZoneInfo("America/New_York")
    start_at = payload.start_at
    if start_at.tzinfo is None:
        start_at = start_at.replace(tzinfo=nyc_tz)
    else:
        start_at = start_at.astimezone(nyc_tz)
    now = datetime.now(nyc_tz)
    if start_at.date() != now.date():
        raise HTTPException(status_code=422, detail="The MVP only supports plans for today.")
    if start_at < now - timedelta(minutes=5):
        raise HTTPException(status_code=422, detail="The start time must be now or later today.")

    itinerary_input = ItineraryInput(
        location_label=payload.location_label,
        coordinates=Coordinates(**payload.coordinates.model_dump()),
        start_at=start_at,
        available_minutes=payload.available_minutes,
        budget_min=payload.budget_min,
        budget_max=payload.budget_max,
        group_size=payload.group_size,
        transport_mode=payload.transport_mode,
        radius_miles=payload.radius_miles,
        mood=payload.mood,
        regeneration_seed=payload.regeneration_seed,
    )
    weather, weather_warnings = await request.app.state.providers.weather(itinerary_input)
    candidates, candidate_warnings = await request.app.state.providers.candidates(itinerary_input)
    result = generate_itineraries(
        itinerary_input,
        candidates,
        weather,
        tuple((*weather_warnings, *candidate_warnings)),
    )
    response = {
        "weather": asdict(result.weather),
        "plans": [asdict(plan) for plan in result.plans],
        "warnings": list(result.warnings),
        "generated_at": result.generated_at,
    }
    return GenerationResponse.model_validate(response)
