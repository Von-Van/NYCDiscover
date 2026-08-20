from __future__ import annotations

from typing import Any

import sentry_sdk

from .config import Settings


def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        request.pop("headers", None)
        request.pop("query_string", None)
        url = request.get("url")
        if isinstance(url, str) and "/shares/" in url:
            request["url"] = url.split("/shares/", 1)[0] + "/shares/:id"
    event.pop("user", None)
    return event


def configure_sentry(settings: Settings) -> None:
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        send_default_pii=False,
        traces_sample_rate=0.1 if settings.sentry_environment == "production" else 0.0,
        before_send=_before_send,
    )
