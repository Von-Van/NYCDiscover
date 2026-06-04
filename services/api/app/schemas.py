from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


Mood = Literal[
    "social",
    "relaxing",
    "outdoors",
    "date-night",
    "productive",
    "chaotic",
    "low-energy",
    "cultural",
    "food-focused",
]
TransportMode = Literal["walk", "bike", "transit"]


class CoordinatesSchema(BaseModel):
    latitude: float = Field(ge=40.4774, le=40.9176)
    longitude: float = Field(ge=-74.2591, le=-73.7002)


class GenerateRequest(BaseModel):
    location_label: str = Field(min_length=2, max_length=160)
    coordinates: CoordinatesSchema
    start_at: datetime
    available_minutes: int = Field(ge=60, le=720)
    budget_min: float = Field(default=0, ge=0, le=500)
    budget_max: float = Field(ge=0, le=500)
    group_size: int = Field(ge=1, le=12)
    transport_mode: TransportMode
    radius_miles: float = Field(ge=0.25, le=10)
    mood: Mood
    regeneration_seed: int = Field(default=0, ge=0, le=1_000_000)

    @model_validator(mode="after")
    def validate_budget(self) -> GenerateRequest:
        if self.budget_min > self.budget_max:
            raise ValueError("budget_min cannot exceed budget_max")
        return self


class GeocodeResult(BaseModel):
    label: str
    latitude: float
    longitude: float


class GeocodeResponse(BaseModel):
    results: list[GeocodeResult]
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    database: str
    fixture_mode: bool


class TravelLegResponse(BaseModel):
    mode: str
    minutes: int
    distance_miles: float
    from_label: str
    to_label: str
    estimate_note: str


class TimelineStepResponse(BaseModel):
    candidate_id: str
    name: str
    category: str
    start_at: datetime
    end_at: datetime
    coordinates: CoordinatesSchema
    cost_low: float
    cost_high: float
    confidence: float
    source_name: str
    source_url: str | None
    estimate_notes: list[str]
    travel_before: TravelLegResponse


class ItineraryPlanResponse(BaseModel):
    id: str
    title: str
    subtitle: str
    score: float
    confidence: float
    total_minutes: int
    total_cost_low: float
    total_cost_high: float
    steps: list[TimelineStepResponse]
    estimate_notes: list[str]


class WeatherResponse(BaseModel):
    summary: str
    temperature_f: int | None
    precipitation_probability: int
    is_wet: bool
    is_severe: bool
    source_name: str


class GenerationResponse(BaseModel):
    weather: WeatherResponse
    plans: list[ItineraryPlanResponse]
    warnings: list[str]
    generated_at: datetime
