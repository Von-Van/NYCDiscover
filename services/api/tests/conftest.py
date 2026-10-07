from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.schemas import SharedItineraryResponse
from app.sharing import redact_share


class ShareStore:
    def __init__(self):
        self.shared = None

    async def create(self, request):
        brief, generation = redact_share(request)
        now = datetime.now(ZoneInfo("America/New_York"))
        self.shared = SharedItineraryResponse(
            id="a" * 22, brief=brief, generation=generation,
            selected_plan_id=request.selected_plan_id, created_at=now,
            expires_at=now + timedelta(days=7),
        )
        return self.shared

    async def get(self, id):
        return self.shared, False


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr("app.main.settings", Settings(fixture_mode=True, database_url="", share_signing_secret="options-test"))
    with TestClient(app) as test_client:
        app.state.share_store = ShareStore()
        yield test_client
