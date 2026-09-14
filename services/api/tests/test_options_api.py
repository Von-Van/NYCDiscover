from copy import deepcopy
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.schemas import CreateShareRequest, GenerationResponse, SharedItineraryResponse
from app.sharing import redact_share, verify_snapshot


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


def generate(client):
    from test_options import candidate

    now = datetime.now(ZoneInfo("America/New_York"))
    brief = {
        "location_label": "123 Secret Origin, Upper West Side",
        "coordinates": {"latitude": 40.787, "longitude": -73.9754},
        "start_at": now.isoformat(), "available_minutes": 240,
        "budget_min": 0, "budget_max": 40, "group_size": 2,
        "transport_mode": "walk", "radius_miles": 2, "mood": "social", "moods": ["social"],
    }
    catalog = [candidate(f"place-{index}", category) for index, category in enumerate([
        "gallery", "museum", "library", "bookstore", "park", "restaurant",
        "cafe", "dessert", "bar", "landmark", "gallery", "museum",
    ])]
    with patch.object(app.state.providers, "candidates", AsyncMock(return_value=(catalog, ()))):
        response = client.post("/api/v1/itineraries/generate", json=brief)
    assert response.status_code == 200, response.text
    generation = response.json()
    plan = generation["plans"][0]
    option = plan["additional_options"][0]
    return {
        "brief": brief, "generation": generation, "swap_token": generation["swap_token"],
        "plan_id": plan["id"], "option_id": option["id"],
    }


def test_repeat_swaps_use_original_candidates_and_share_the_customized_plan(client, monkeypatch):
    payload = generate(client)
    providers = AsyncMock(side_effect=AssertionError("Swaps must not call providers"))
    monkeypatch.setattr(app.state.providers, "candidates", providers)
    monkeypatch.setattr(app.state.providers, "weather", providers)
    original = deepcopy(payload)
    for attempt in range(2):
        old_plan = next(plan for plan in payload["generation"]["plans"] if plan["id"] == payload["plan_id"])
        option = next(item for item in old_plan["additional_options"] if item["id"] == payload["option_id"])
        response = client.post("/api/v1/itineraries/apply-option", json=payload)
        assert response.status_code == 200, response.text
        updated = response.json()
        changed = next(plan for plan in updated["plans"] if plan["id"] == payload["plan_id"])
        assert option["step"]["candidate_id"] in [step["candidate_id"] for step in changed["steps"]]
        assert changed["total_minutes"] == option["total_minutes"]
        assert changed["total_cost_high"] == option["total_cost_high"]
        assert updated["snapshot_token"] != payload["generation"]["snapshot_token"]
        assert updated["swap_token"] != payload["swap_token"]
        assert updated["candidate_context"] == original["generation"]["candidate_context"]
        payload.update(generation=updated, swap_token=updated["swap_token"])
        if attempt == 0:
            payload["option_id"] = changed["additional_options"][-1]["id"]
    providers.assert_not_called()
    share_payload = {
        "brief": payload["brief"], "generation": updated,
        "snapshot_token": updated["snapshot_token"], "selected_plan_id": payload["plan_id"],
    }
    assert verify_snapshot(CreateShareRequest.model_validate(share_payload), "options-test")
    result = client.post("/api/v1/shares", json=share_payload)
    assert result.status_code == 201, result.text
    shared = client.get(f'/api/v1/shares/{result.json()["id"]}').json()
    assert shared["selected_plan_id"] == payload["plan_id"]
    assert shared["generation"]["candidate_context"] is None
    assert shared["generation"]["swap_token"] is None
    assert shared["generation"]["snapshot_token"] is None
    assert all(not plan["additional_options"] for plan in shared["generation"]["plans"])
    assert "123 Secret Origin" not in str(shared)
    shared_plan = next(plan for plan in shared["generation"]["plans"] if plan["id"] == changed["id"])
    assert [step["candidate_id"] for step in shared_plan["steps"]] == [step["candidate_id"] for step in changed["steps"]]


@pytest.mark.parametrize("target", ["brief", "candidate", "plan", "option"])
def test_swap_rejects_tampered_generation(client, target):
    payload = generate(client)
    if target == "brief":
        payload["brief"]["budget_max"] = 500
    elif target == "candidate":
        payload["generation"]["candidate_context"][0]["cost_high"] = 999
    elif target == "plan":
        payload["generation"]["plans"][0]["title"] = "Tampered"
    else:
        payload["generation"]["plans"][0]["additional_options"][0]["total_minutes"] = 1
    assert client.post("/api/v1/itineraries/apply-option", json=payload).status_code == 400


def test_swap_rejects_unknown_option_and_expired_token(client, monkeypatch):
    payload = generate(client)
    bad = {**payload, "option_id": "not-offered"}
    assert client.post("/api/v1/itineraries/apply-option", json=bad).status_code == 422
    issued = int(payload["swap_token"].split(".")[0])
    monkeypatch.setattr("app.sharing.time.time", lambda: issued + 3601)
    assert client.post("/api/v1/itineraries/apply-option", json=payload).status_code == 400


def test_swaps_work_without_sharing_configuration(monkeypatch):
    monkeypatch.setattr("app.main.settings", Settings(fixture_mode=True, database_url="", share_signing_secret=""))
    with TestClient(app) as client:
        payload = generate(client)
        assert payload["generation"]["snapshot_token"] is None
        result = client.post("/v1/itineraries/apply-option", json=payload)
        assert result.status_code == 200, result.text
        assert result.json()["snapshot_token"] is None
        assert result.json()["swap_token"]


def test_legacy_generation_still_loads_without_additional_options():
    from test_launch_security import generation

    legacy = generation().model_dump(exclude={"candidate_context", "swap_token"})
    for plan in legacy["plans"]:
        plan.pop("additional_options")
    parsed = GenerationResponse.model_validate(legacy)
    assert parsed.candidate_context is None
    assert parsed.plans[0].additional_options == []
