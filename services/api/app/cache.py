from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol


class ProviderCache(Protocol):
    status: str

    async def get(self, key: str, allow_stale: bool = False) -> dict[str, Any] | list[Any] | None: ...

    async def set(
        self, key: str, value: dict[str, Any] | list[Any], ttl_seconds: int, stale_seconds: int
    ) -> None: ...

    async def close(self) -> None: ...


@dataclass(slots=True)
class _MemoryEntry:
    value: dict[str, Any] | list[Any]
    expires_at: datetime
    stale_until: datetime


class MemoryProviderCache:
    status = "memory"

    def __init__(self) -> None:
        self._entries: dict[str, _MemoryEntry] = {}

    async def get(self, key: str, allow_stale: bool = False) -> dict[str, Any] | list[Any] | None:
        entry = self._entries.get(key)
        if not entry:
            return None
        now = datetime.now(UTC)
        if entry.expires_at >= now or (allow_stale and entry.stale_until >= now):
            return entry.value
        return None

    async def set(
        self, key: str, value: dict[str, Any] | list[Any], ttl_seconds: int, stale_seconds: int
    ) -> None:
        now = datetime.now(UTC)
        self._entries[key] = _MemoryEntry(
            value=value,
            expires_at=now + timedelta(seconds=ttl_seconds),
            stale_until=now + timedelta(seconds=ttl_seconds + stale_seconds),
        )

    async def close(self) -> None:
        self._entries.clear()


class PostgresProviderCache:
    status = "postgres"

    def __init__(self, pool: Any) -> None:
        self.pool = pool

    async def get(self, key: str, allow_stale: bool = False) -> dict[str, Any] | list[Any] | None:
        column = "stale_until" if allow_stale else "expires_at"
        async with self.pool.acquire() as connection:
            row = await connection.fetchrow(
                f"SELECT payload FROM provider_cache WHERE cache_key = $1 AND {column} >= NOW()", key
            )
        if not row:
            return None
        payload = row["payload"]
        return json.loads(payload) if isinstance(payload, str) else payload

    async def set(
        self, key: str, value: dict[str, Any] | list[Any], ttl_seconds: int, stale_seconds: int
    ) -> None:
        now = datetime.now(UTC)
        async with self.pool.acquire() as connection:
            await connection.execute(
                """
                INSERT INTO provider_cache (cache_key, payload, expires_at, stale_until, updated_at)
                VALUES ($1, $2::jsonb, $3, $4, NOW())
                ON CONFLICT (cache_key) DO UPDATE SET
                    payload = EXCLUDED.payload,
                    expires_at = EXCLUDED.expires_at,
                    stale_until = EXCLUDED.stale_until,
                    updated_at = NOW()
                """,
                key,
                json.dumps(value),
                now + timedelta(seconds=ttl_seconds),
                now + timedelta(seconds=ttl_seconds + stale_seconds),
            )

    async def close(self) -> None:
        return None
