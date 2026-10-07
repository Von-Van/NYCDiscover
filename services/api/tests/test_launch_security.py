import asyncio
import json
from app.config import Settings
from app.limits import MemoryRateLimiter, anonymized_client_key
from app.schemas import GenerateRequest
from app.sharing import redact_share, verify_snapshot
from helpers import generate_request, share_request


def test_snapshot_signature_accepts_exact_response_and_rejects_tampering(monkeypatch):
    monkeypatch.setattr("app.sharing.time.time", lambda: 2_000_000_100)
    request = share_request()
    assert verify_snapshot(request, "test-secret")

    request.generation.plans[0].total_cost_high = 1
    assert not verify_snapshot(request, "test-secret")


def test_snapshot_signature_expires_after_one_hour(monkeypatch):
    monkeypatch.setattr("app.sharing.time.time", lambda: 2_000_003_601)
    assert not verify_snapshot(share_request(), "test-secret")


def test_shared_snapshot_removes_every_origin_field():
    request = share_request()
    shared_brief, shared_generation = redact_share(request)
    serialized = json.dumps(
        {
            "brief": shared_brief.model_dump(mode="json"),
            "generation": shared_generation.model_dump(mode="json"),
        }
    )

    assert "123 Secret Street" not in serialized
    assert "40.6895" not in serialized
    assert "-73.9857" not in serialized
    assert "regeneration_seed" not in serialized
    assert shared_generation.plans[0].steps[0].travel_before.from_label == "Starting point"
    assert shared_generation.snapshot_token is None


def test_memory_rate_limiter_returns_retry_after(monkeypatch):
    async def scenario():
        monkeypatch.setattr("app.limits.time.time", lambda: 1_700_000_001)
        limiter = MemoryRateLimiter()
        assert await limiter.check("client", 2, 600) is None
        assert await limiter.check("client", 2, 600) is None
        assert await limiter.check("client", 2, 600) == 399

    asyncio.run(scenario())


def test_rate_limit_key_is_stable_scoped_and_contains_no_raw_ip():
    geocode = anonymized_client_key("203.0.113.8", "secret", "geocode")
    generate = anonymized_client_key("203.0.113.8", "secret", "generate")
    assert geocode == anonymized_client_key("203.0.113.8", "secret", "geocode")
    assert geocode != generate
    assert "203.0.113.8" not in geocode


def test_live_settings_require_shared_state_and_contactable_identity():
    settings = Settings(
        fixture_mode=False,
        database_url="",
        nyc_event_calendar_key="",
        share_signing_secret="",
        request_hash_secret="",
    )
    try:
        settings.validate_live()
    except RuntimeError as error:
        message = str(error)
    else:
        raise AssertionError("Live settings should reject missing infrastructure")

    assert "DATABASE_URL" in message
    assert "NYC_EVENT_CALENDAR_KEY" in message
    assert "SHARE_SIGNING_SECRET" in message
    assert "REQUEST_HASH_SECRET" in message
    assert "NYC_DISCOVER_USER_AGENT" in message


def test_generate_request_normalizes_legacy_and_multiple_moods():
    legacy = generate_request()
    multiple = GenerateRequest.model_validate(
        {**legacy.model_dump(), "mood": "social", "moods": ["social", "cultural"]}
    )

    assert legacy.moods == ["cultural"]
    assert multiple.moods == ["social", "cultural"]
