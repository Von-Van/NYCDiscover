from __future__ import annotations

import asyncio
import hashlib
import hmac
import math
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol


class ProviderBusyError(RuntimeError):
    pass


class ProviderThrottle(Protocol):
    async def wait(self, provider: str, interval_seconds: float) -> None: ...


class MemoryProviderThrottle:
    def __init__(self) -> None:
        self._last_request: dict[str, float] = defaultdict(float)
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def wait(self, provider: str, interval_seconds: float) -> None:
        async with self._locks[provider]:
            delay = interval_seconds - (time.monotonic() - self._last_request[provider])
            if delay > 0:
                await asyncio.sleep(delay)
            self._last_request[provider] = time.monotonic()


class PostgresProviderThrottle:
    def __init__(self, pool: Any, max_wait_seconds: float = 5) -> None:
        self.pool = pool
        self.max_wait_seconds = max_wait_seconds

    async def wait(self, provider: str, interval_seconds: float) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    INSERT INTO provider_throttle (provider, next_allowed_at)
                    VALUES ($1, NOW())
                    ON CONFLICT (provider) DO NOTHING
                    """,
                    provider,
                )
                scheduled_at = await connection.fetchval(
                    """
                    UPDATE provider_throttle
                    SET next_allowed_at = GREATEST(next_allowed_at, NOW())
                        + ($2 * INTERVAL '1 second')
                    WHERE provider = $1
                      AND next_allowed_at <= NOW() + ($3 * INTERVAL '1 second')
                    RETURNING next_allowed_at - ($2 * INTERVAL '1 second')
                    """,
                    provider,
                    interval_seconds,
                    self.max_wait_seconds,
                )
        if scheduled_at is None:
            raise ProviderBusyError(f"{provider} is temporarily busy")
        delay = (scheduled_at - datetime.now(UTC)).total_seconds()
        if delay > 0:
            await asyncio.sleep(delay)


class RateLimiter(Protocol):
    async def check(self, key: str, limit: int, window_seconds: int) -> int | None: ...


class MemoryRateLimiter:
    def __init__(self) -> None:
        self._counts: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()

    async def check(self, key: str, limit: int, window_seconds: int) -> int | None:
        now = time.time()
        bucket_start = math.floor(now / window_seconds) * window_seconds
        bucket_key = f"{key}:{bucket_start}"
        async with self._lock:
            count, _ = self._counts.get(bucket_key, (0, bucket_start + window_seconds))
            count += 1
            self._counts[bucket_key] = (count, bucket_start + window_seconds)
        if count <= limit:
            return None
        return max(1, math.ceil(bucket_start + window_seconds - now))


class PostgresRateLimiter:
    def __init__(self, pool: Any) -> None:
        self.pool = pool

    async def check(self, key: str, limit: int, window_seconds: int) -> int | None:
        now = datetime.now(UTC)
        epoch = int(now.timestamp())
        bucket_epoch = epoch - (epoch % window_seconds)
        expires_at = datetime.fromtimestamp(bucket_epoch, UTC) + timedelta(seconds=window_seconds)
        bucket_key = f"{key}:{bucket_epoch}"
        async with self.pool.acquire() as connection:
            count = await connection.fetchval(
                """
                INSERT INTO api_rate_limits (bucket_key, request_count, expires_at)
                VALUES ($1, 1, $2)
                ON CONFLICT (bucket_key) DO UPDATE
                SET request_count = api_rate_limits.request_count + 1
                RETURNING request_count
                """,
                bucket_key,
                expires_at,
            )
            await connection.execute("DELETE FROM api_rate_limits WHERE expires_at < NOW()")
        if count <= limit:
            return None
        return max(1, math.ceil((expires_at - now).total_seconds()))


def anonymized_client_key(ip_address: str, secret: str, scope: str) -> str:
    digest = hmac.new(secret.encode(), ip_address.encode(), hashlib.sha256).hexdigest()
    return f"{scope}:{digest}"
