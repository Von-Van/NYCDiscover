import asyncio
import os
import time
from datetime import UTC, datetime, timedelta

import pytest

from app.cache import PostgresProviderCache
from app.database import Database, run_migrations
from app.limits import PostgresProviderThrottle, PostgresRateLimiter
from app.sharing import PostgresShareStore
from test_launch_security import share_request


DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="TEST_DATABASE_URL is not configured")


async def clean(database: Database) -> None:
    async with database.pool.acquire() as connection:
        await connection.execute("TRUNCATE provider_cache, provider_throttle, api_rate_limits, shared_itineraries")


def test_migrations_are_repeatable_and_schema_is_ready():
    async def scenario():
        await run_migrations(DATABASE_URL)
        database = await Database.connect(DATABASE_URL)
        try:
            assert await database.schema_ready()
            assert await run_migrations(DATABASE_URL) == []
        finally:
            await database.close()

    asyncio.run(scenario())


def test_postgres_cache_serves_stale_values_after_fresh_expiry():
    async def scenario():
        await run_migrations(DATABASE_URL)
        database = await Database.connect(DATABASE_URL)
        try:
            await clean(database)
            cache = PostgresProviderCache(database.pool)
            await cache.set("provider:key", {"ok": True}, ttl_seconds=-1, stale_seconds=60)
            assert await cache.get("provider:key") is None
            assert await cache.get("provider:key", allow_stale=True) == {"ok": True}
        finally:
            await database.close()

    asyncio.run(scenario())


def test_postgres_throttle_serializes_across_instances():
    async def scenario():
        await run_migrations(DATABASE_URL)
        database = await Database.connect(DATABASE_URL)
        try:
            await clean(database)
            left = PostgresProviderThrottle(database.pool)
            right = PostgresProviderThrottle(database.pool)
            started = time.monotonic()
            await asyncio.gather(left.wait("provider", 0.12), right.wait("provider", 0.12))
            assert time.monotonic() - started >= 0.1
        finally:
            await database.close()

    asyncio.run(scenario())


def test_postgres_rate_limit_is_shared():
    async def scenario():
        await run_migrations(DATABASE_URL)
        database = await Database.connect(DATABASE_URL)
        try:
            await clean(database)
            left = PostgresRateLimiter(database.pool)
            right = PostgresRateLimiter(database.pool)
            assert await left.check("shared-client", 2, 600) is None
            assert await right.check("shared-client", 2, 600) is None
            assert await left.check("shared-client", 2, 600) is not None
        finally:
            await database.close()

    asyncio.run(scenario())


def test_postgres_share_store_round_trip_and_expiry_cleanup():
    async def scenario():
        await run_migrations(DATABASE_URL)
        database = await Database.connect(DATABASE_URL)
        try:
            await clean(database)
            store = PostgresShareStore(database.pool)
            created = await store.create(share_request())
            loaded, expired = await store.get(created.id)
            assert not expired
            assert loaded is not None
            assert loaded.selected_plan_id == "plan-1"
            assert loaded.generation.plans[0].steps[0].travel_before.from_label == "Starting point"

            async with database.pool.acquire() as connection:
                await connection.execute(
                    "UPDATE shared_itineraries SET expires_at = $2 WHERE share_id = $1",
                    created.id,
                    datetime.now(UTC) - timedelta(seconds=1),
                )
            loaded, expired = await store.get(created.id)
            assert loaded is None
            assert expired
            missing, expired_again = await store.get(created.id)
            assert missing is None
            assert not expired_again
        finally:
            await database.close()

    asyncio.run(scenario())
