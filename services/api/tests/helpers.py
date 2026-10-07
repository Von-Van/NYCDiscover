"""Builders shared across test modules: planner inputs and signed wire payloads."""
from datetime import datetime
from zoneinfo import ZoneInfo

from app.domain import Candidate, Coordinates, ItineraryInput
from app.engine import _beam_to_plan, _rebuild_route
from app.fixtures import fixture_weather
from app.schemas import CreateShareRequest, GenerateRequest, GenerationResponse
from app.sharing import sign_snapshot


def brief(**overrides):
    values = dict(
        location_label="Upper West Side",
        coordinates=Coordinates(40.787, -73.9754),
        start_at=datetime(2026, 9, 5, 15, 0, tzinfo=ZoneInfo("America/New_York")),
        available_minutes=180, budget_min=0, budget_max=40, group_size=2,
        transport_mode="walk", radius_miles=2, mood="social", moods=("social",),
    )
    return ItineraryInput(**{**values, **overrides})


def candidate(id, category="gallery", **overrides):
    values = dict(
        id=id, name=id.title(), category=category, mood_tags=("social", "food-focused"),
        coordinates=Coordinates(40.7871, -73.9755), duration_minutes=20,
        cost_low=0, cost_high=0, indoor=True, source_name="Test", source_url=None,
        confidence=0.9,
    )
    return Candidate(**{**values, **overrides})


def plan(request, candidates, index=0):
    beam = _rebuild_route(request, candidates, fixture_weather())
    assert beam is not None
    return _beam_to_plan(beam, request, index)


def generate_request() -> GenerateRequest:
    return GenerateRequest.model_validate(
        {
            "location_label": "123 Secret Street, Brooklyn",
            "coordinates": {"latitude": 40.6895, "longitude": -73.9857},
            "start_at": "2026-08-19T18:00:00-04:00",
            "available_minutes": 180,
            "budget_min": 10,
            "budget_max": 60,
            "group_size": 2,
            "transport_mode": "walk",
            "radius_miles": 2,
            "mood": "cultural",
            "regeneration_seed": 42,
        }
    )


def generation_response() -> GenerationResponse:
    return GenerationResponse.model_validate(
        {
            "weather": {
                "summary": "Clear",
                "temperature_f": 72,
                "precipitation_probability": 5,
                "is_wet": False,
                "is_severe": False,
                "source_name": "NWS",
            },
            "plans": [
                {
                    "id": "plan-1",
                    "title": "Gallery and dinner",
                    "subtitle": "An easy evening",
                    "score": 0.9,
                    "confidence": 0.8,
                    "total_minutes": 150,
                    "total_cost_low": 20,
                    "total_cost_high": 50,
                    "steps": [
                        {
                            "candidate_id": "gallery-1",
                            "name": "Example Gallery",
                            "category": "gallery",
                            "start_at": "2026-08-19T18:15:00-04:00",
                            "end_at": "2026-08-19T19:00:00-04:00",
                            "coordinates": {"latitude": 40.69, "longitude": -73.986},
                            "cost_low": 0,
                            "cost_high": 10,
                            "confidence": 0.8,
                            "source_name": "OpenStreetMap",
                            "source_url": None,
                            "estimate_notes": ["Verify hours."],
                            "travel_before": {
                                "mode": "walk",
                                "minutes": 15,
                                "distance_miles": 0.7,
                                "from_label": "123 Secret Street, Brooklyn",
                                "to_label": "Example Gallery",
                                "estimate_note": "Estimated.",
                            },
                        }
                    ],
                    "estimate_notes": ["Verify before leaving."],
                }
            ],
            "warnings": [],
            "generated_at": "2026-08-19T17:55:00-04:00",
            "data_mode": "live",
            "snapshot_token": None,
        }
    )


def share_request(issued_at: int = 2_000_000_000) -> CreateShareRequest:
    request_brief = generate_request()
    result = generation_response()
    token = sign_snapshot(request_brief, result, "test-secret", issued_at=issued_at)
    return CreateShareRequest(
        brief=request_brief,
        generation=result,
        snapshot_token=token,
        selected_plan_id="plan-1",
    )
