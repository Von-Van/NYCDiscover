from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .cache import MemoryProviderCache, PostgresProviderCache
from .config import settings
from .database import Database
from .domain import Coordinates, ItineraryInput
from .engine import generate_itineraries
from .limits import (
    MemoryProviderThrottle,
    MemoryRateLimiter,
    PostgresProviderThrottle,
    PostgresRateLimiter,
    ProviderBusyError,
    anonymized_client_key,
)
from .observability import configure_sentry
from .prefix import ServicePrefixMiddleware
from .providers import ProviderHub
from .schemas import (
    CreateShareRequest,
    CreateShareResponse,
    GenerateRequest,
    GenerationResponse,
    GeocodeResponse,
    HealthResponse,
    SharedItineraryResponse,
)
from .sharing import PostgresShareStore, sign_snapshot, verify_snapshot


configure_sentry(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_live()
    database = None
    if settings.database_url:
        try:
            database = await Database.connect(settings.database_url)
            if not await database.schema_ready():
                raise RuntimeError("Database migrations have not been applied.")
        except Exception:
            if not settings.fixture_mode:
                raise
            if database:
                await database.close()
            database = None

    if not settings.fixture_mode and database is None:
        raise RuntimeError("Live mode requires a migrated PostgreSQL database.")

    cache = (
        MemoryProviderCache()
        if settings.fixture_mode
        else PostgresProviderCache(database.pool)
    )
    throttle = (
        MemoryProviderThrottle()
        if settings.fixture_mode
        else PostgresProviderThrottle(database.pool)
    )
    app.state.cache = cache
    app.state.database = database
    app.state.providers = ProviderHub(settings, cache, throttle)
    app.state.rate_limiter = (
        PostgresRateLimiter(database.pool)
        if database and not settings.fixture_mode
        else MemoryRateLimiter()
    )
    app.state.share_store = PostgresShareStore(database.pool) if database else None
    yield
    await cache.close()
    if database:
        await database.close()


app = FastAPI(
    title="NYC Discover API",
    version="0.1.0",
    description="Same-day, constraint-aware NYC itinerary generation.",
    lifespan=lifespan,
)
app.add_middleware(ServicePrefixMiddleware, prefix="/api")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse | JSONResponse:
    database = request.app.state.database
    database_status = database.status if database else "memory"
    status = "ok"
    if database:
        try:
            await database.ping()
        except Exception:
            database_status = "unavailable"
            status = "degraded"
    response = HealthResponse(
        status=status,
        database=database_status,
        fixture_mode=settings.fixture_mode,
        sharing_enabled=(
            request.app.state.share_store is not None
            and bool(settings.share_signing_secret)
        ),
    )
    if status == "degraded" and not settings.fixture_mode:
        return JSONResponse(status_code=503, content=response.model_dump(mode="json"))
    return response


async def enforce_limit(
    request: Request,
    scope: str,
    limit: int,
    window_seconds: int,
) -> None:
    if settings.fixture_mode:
        return
    automation_secret = request.headers.get("x-vercel-protection-bypass", "")
    if (
        settings.vercel_automation_bypass_secret
        and automation_secret
        and hmac.compare_digest(
            automation_secret, settings.vercel_automation_bypass_secret
        )
    ):
        return
    forwarded = (
        request.headers.get("x-vercel-forwarded-for")
        or (request.client.host if request.client else "unknown")
    )
    ip_address = forwarded.split(",", 1)[0].strip()
    secret = settings.request_hash_secret or "fixture-local-rate-limit"
    key = anonymized_client_key(ip_address, secret, scope)
    try:
        retry_after = await request.app.state.rate_limiter.check(key, limit, window_seconds)
    except Exception as exc:
        if settings.fixture_mode:
            raise
        raise HTTPException(
            status_code=503,
            detail="Shared request controls are temporarily unavailable.",
        ) from exc
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )


@app.get("/v1/geocode", response_model=GeocodeResponse)
async def geocode(
    request: Request, q: str = Query(min_length=3, max_length=120)
) -> GeocodeResponse:
    await enforce_limit(request, "geocode", 30, 600)
    try:
        results, warnings = await request.app.state.providers.geocode(q.strip())
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Geocoding is temporarily unavailable.") from exc
    return GeocodeResponse(results=results, warnings=list(warnings))


@app.post("/v1/itineraries/generate", response_model=GenerationResponse)
async def generate(payload: GenerateRequest, request: Request) -> GenerationResponse:
    await enforce_limit(request, "generate", 6, 600)
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
        moods=tuple(payload.moods),
        regeneration_seed=payload.regeneration_seed,
    )
    try:
        weather, weather_warnings = await request.app.state.providers.weather(itinerary_input)
        candidates, candidate_warnings = await request.app.state.providers.candidates(itinerary_input)
    except ProviderBusyError as exc:
        raise HTTPException(status_code=503, detail="Live data providers are busy. Try again shortly.") from exc
    result = generate_itineraries(
        itinerary_input,
        candidates,
        weather,
        tuple((*weather_warnings, *candidate_warnings)),
    )
    response = GenerationResponse.model_validate({
        "weather": asdict(result.weather),
        "plans": [asdict(plan) for plan in result.plans],
        "warnings": list(result.warnings),
        "generated_at": result.generated_at,
        "data_mode": "fixture" if settings.fixture_mode else "live",
        "snapshot_token": None,
    })
    if request.app.state.share_store and settings.share_signing_secret:
        response.snapshot_token = sign_snapshot(payload, response, settings.share_signing_secret)
    return response


@app.post("/v1/shares", response_model=CreateShareResponse, status_code=201)
async def create_share(payload: CreateShareRequest, request: Request) -> CreateShareResponse:
    await enforce_limit(request, "share-create", 10, 86400)
    store = request.app.state.share_store
    if store is None or not settings.share_signing_secret:
        raise HTTPException(status_code=503, detail="Sharing is unavailable in this environment.")
    if not verify_snapshot(payload, settings.share_signing_secret):
        raise HTTPException(status_code=400, detail="The itinerary snapshot is invalid or expired.")
    if payload.selected_plan_id not in {plan.id for plan in payload.generation.plans}:
        raise HTTPException(status_code=422, detail="The selected plan is not part of this itinerary.")
    shared = await store.create(payload)
    return CreateShareResponse(id=shared.id, path=f"/share/{shared.id}", expires_at=shared.expires_at)


@app.get("/v1/shares/{share_id}", response_model=SharedItineraryResponse)
async def get_share(
    request: Request,
    share_id: str = Path(pattern=r"^[A-Za-z0-9_-]{22}$"),
) -> SharedItineraryResponse:
    await enforce_limit(request, "share-read", 120, 600)
    store = request.app.state.share_store
    if store is None:
        raise HTTPException(status_code=503, detail="Sharing is unavailable in this environment.")
    shared, expired = await store.get(share_id)
    if expired:
        raise HTTPException(status_code=410, detail="This shared itinerary has expired.")
    if shared is None:
        raise HTTPException(status_code=404, detail="Shared itinerary not found.")
    return shared
