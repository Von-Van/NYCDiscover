from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from .schemas import (
    CreateShareRequest,
    GenerateRequest,
    GenerationResponse,
    SharedBrief,
    SharedItineraryResponse,
)


def _canonical_snapshot(brief: GenerateRequest, generation: GenerationResponse) -> bytes:
    generation_data = generation.model_dump(mode="json")
    generation_data["snapshot_token"] = None
    payload = {"brief": brief.model_dump(mode="json"), "generation": generation_data}
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def sign_snapshot(
    brief: GenerateRequest,
    generation: GenerationResponse,
    secret: str,
    issued_at: int | None = None,
) -> str:
    timestamp = issued_at or int(time.time())
    material = str(timestamp).encode() + b"." + _canonical_snapshot(brief, generation)
    signature = hmac.new(secret.encode(), material, hashlib.sha256).digest()
    encoded = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{timestamp}.{encoded}"


def verify_snapshot(request: CreateShareRequest, secret: str, max_age_seconds: int = 3600) -> bool:
    try:
        timestamp_text, _ = request.snapshot_token.split(".", 1)
        timestamp = int(timestamp_text)
    except (ValueError, AttributeError):
        return False
    age = int(time.time()) - timestamp
    if age < -60 or age > max_age_seconds:
        return False
    expected = sign_snapshot(request.brief, request.generation, secret, timestamp)
    return hmac.compare_digest(expected, request.snapshot_token)


def redact_share(request: CreateShareRequest) -> tuple[SharedBrief, GenerationResponse]:
    brief = SharedBrief(
        start_at=request.brief.start_at,
        available_minutes=request.brief.available_minutes,
        budget_min=request.brief.budget_min,
        budget_max=request.brief.budget_max,
        group_size=request.brief.group_size,
        transport_mode=request.brief.transport_mode,
        radius_miles=request.brief.radius_miles,
        mood=request.brief.mood,
        moods=request.brief.moods,
    )
    generation = request.generation.model_copy(deep=True)
    generation.snapshot_token = None
    for plan in generation.plans:
        if plan.steps:
            plan.steps[0].travel_before.from_label = "Starting point"
    return brief, generation


class PostgresShareStore:
    def __init__(self, pool: Any) -> None:
        self.pool = pool

    async def create(self, request: CreateShareRequest) -> SharedItineraryResponse:
        brief, generation = redact_share(request)
        share_id = secrets.token_urlsafe(16)
        expires_at = datetime.now(UTC) + timedelta(days=7)
        async with self.pool.acquire() as connection:
            row = await connection.fetchrow(
                """
                INSERT INTO shared_itineraries
                    (share_id, brief, generation, selected_plan_id, expires_at)
                VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)
                RETURNING created_at, expires_at
                """,
                share_id,
                json.dumps(brief.model_dump(mode="json")),
                json.dumps(generation.model_dump(mode="json")),
                request.selected_plan_id,
                expires_at,
            )
            await connection.execute("DELETE FROM shared_itineraries WHERE expires_at < NOW()")
        return SharedItineraryResponse(
            id=share_id,
            brief=brief,
            generation=generation,
            selected_plan_id=request.selected_plan_id,
            created_at=row["created_at"],
            expires_at=row["expires_at"],
        )

    async def get(self, share_id: str) -> tuple[SharedItineraryResponse | None, bool]:
        async with self.pool.acquire() as connection:
            row = await connection.fetchrow(
                "SELECT * FROM shared_itineraries WHERE share_id = $1", share_id
            )
        if not row:
            return None, False
        if row["expires_at"] < datetime.now(UTC):
            async with self.pool.acquire() as connection:
                await connection.execute(
                    "DELETE FROM shared_itineraries WHERE share_id = $1", share_id
                )
            return None, True
        brief_data = row["brief"] if isinstance(row["brief"], dict) else json.loads(row["brief"])
        generation_data = (
            row["generation"]
            if isinstance(row["generation"], dict)
            else json.loads(row["generation"])
        )
        return (
            SharedItineraryResponse(
                id=row["share_id"],
                brief=SharedBrief.model_validate(brief_data),
                generation=GenerationResponse.model_validate(generation_data),
                selected_plan_id=row["selected_plan_id"],
                created_at=row["created_at"],
                expires_at=row["expires_at"],
            ),
            False,
        )
