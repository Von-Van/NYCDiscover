from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import asyncpg


class Database:
    status = "postgres"

    def __init__(self, pool: Any) -> None:
        self.pool = pool

    @classmethod
    async def connect(cls, database_url: str) -> Database:
        pool = await asyncio.wait_for(
            asyncpg.create_pool(
                database_url,
                min_size=0,
                max_size=2,
                command_timeout=15,
            ),
            timeout=5,
        )
        database = cls(pool)
        await database.ping()
        return database

    async def ping(self) -> None:
        async with self.pool.acquire() as connection:
            await connection.execute("SELECT 1")

    async def schema_ready(self) -> bool:
        async with self.pool.acquire() as connection:
            tables = await connection.fetchval(
                """
                SELECT COUNT(*)
                FROM unnest($1::text[]) AS required(name)
                WHERE to_regclass('public.' || required.name) IS NOT NULL
                """,
                ["provider_cache", "provider_throttle", "api_rate_limits", "shared_itineraries"],
            )
        return tables == 4

    async def close(self) -> None:
        await self.pool.close()


async def run_migrations(database_url: str, migrations_dir: Path | None = None) -> list[str]:
    directory = migrations_dir or Path(__file__).resolve().parent.parent / "migrations"
    connection = await asyncpg.connect(database_url)
    applied: list[str] = []
    try:
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        for migration in sorted(directory.glob("*.sql")):
            exists = await connection.fetchval(
                "SELECT 1 FROM schema_migrations WHERE version = $1", migration.name
            )
            if exists:
                continue
            async with connection.transaction():
                await connection.execute(migration.read_text(encoding="utf-8"))
                await connection.execute(
                    "INSERT INTO schema_migrations (version) VALUES ($1)", migration.name
                )
            applied.append(migration.name)
    finally:
        await connection.close()
    return applied
