from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any


ASGIReceive = Callable[[], Awaitable[dict[str, Any]]]
ASGISend = Callable[[dict[str, Any]], Awaitable[None]]
ASGIApp = Callable[[dict[str, Any], ASGIReceive, ASGISend], Awaitable[None]]


class ServicePrefixMiddleware:
    """Mount an ASGI app below a platform prefix without changing its routes."""

    def __init__(self, app: ASGIApp, prefix: str) -> None:
        self.app = app
        self.prefix = f"/{prefix.strip('/')}"
        self.prefix_bytes = self.prefix.encode()

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: ASGIReceive,
        send: ASGISend,
    ) -> None:
        if scope["type"] in {"http", "websocket"}:
            path = scope.get("path", "")
            if path == self.prefix or path.startswith(f"{self.prefix}/"):
                scope = {
                    **scope,
                    "path": path[len(self.prefix) :] or "/",
                    "root_path": f"{scope.get('root_path', '')}{self.prefix}",
                }
                raw_path = scope.get("raw_path")
                if isinstance(raw_path, bytes) and raw_path.startswith(self.prefix_bytes):
                    scope["raw_path"] = raw_path[len(self.prefix_bytes) :] or b"/"

        await self.app(scope, receive, send)
