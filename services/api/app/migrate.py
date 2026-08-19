from __future__ import annotations

import asyncio

from .config import settings
from .database import run_migrations


async def main() -> None:
    if not settings.database_url:
        raise SystemExit("DATABASE_URL is required to run migrations.")
    applied = await run_migrations(settings.database_url)
    print("Applied migrations: " + (", ".join(applied) if applied else "none"))


if __name__ == "__main__":
    asyncio.run(main())
