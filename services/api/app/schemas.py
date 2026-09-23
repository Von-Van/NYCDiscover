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
DiscoveryMode = Literal["easy", "new", "surprise"]


class PlaceDetailsSchema(BaseModel):
    description: str = ""
    activity: str = ""
    neighborhood: str = ""
    borough: str = ""
    price_status: Literal["free", "verified", "estimated", "unknown"] = "estimated"
    registration: str | None = None
    source_urls: list[str] = Field(default_factory=list)
    reviewed_at: str | None = None
    signature: bool = False
    prompt: str | None = None


class TodayReasonSchema(BaseModel):
    kind: str
    text: str
    source_url: str | None = None


class WeatherPeriodSchema(BaseModel):
    start_at: datetime
    end_at: datetime
    precipitation_probability: int
    is_severe: bool = False


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
    moods: list[Mood] = Field(default_factory=list, max_length=3)
    regeneration_seed: int = Field(default=0, ge=0, le=1_000_000)
    centerpiece_id: str | None = Field(default=None, max_length=200)
    discovery_mode: DiscoveryMode = "new"
    seen_candidate_ids: list[str] = Field(default_factory=list, max_length=200)
    visited_candidate_ids: list[str] = Field(default_factory=list, max_length=200)
    excluded_candidate_ids: list[str] = Field(default_factory=list, max_length=200)
    locked_candidate_ids: list[str] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_budget(self) -> GenerateRequest:
        if self.budget_min > self.budget_max:
            raise ValueError("budget_min cannot exceed budget_max")
        selected = list(dict.fromkeys(self.moods or [self.mood]))
        if self.mood not in selected:
            selected.insert(0, self.mood)
        if len(selected) > 3:
            raise ValueError("Choose no more than three moods")
        self.moods = selected
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
    sharing_enabled: bool


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
    details: PlaceDetailsSchema | None = None
    why_today: TodayReasonSchema | None = None
    schedule_kind: Literal["fixed_start", "drop_in", "opening_hours"] | None = None
    window_start_at: datetime | None = None
    window_end_at: datetime | None = None


class AdditionalOptionResponse(BaseModel):
    id: str
    replaces_candidate_id: str
    step: TimelineStepResponse
    total_minutes: int
    total_cost_low: float
    total_cost_high: float
    confidence: float


class CandidateResponse(BaseModel):
    id: str
    name: str
    category: str
    mood_tags: list[str]
    coordinates: CoordinatesSchema
    duration_minutes: int
    cost_low: float
    cost_high: float
    indoor: bool | None
    source_name: str
    source_url: str | None
    confidence: float
    start_at: datetime | None = None
    end_at: datetime | None = None
    estimate_notes: list[str] = Field(default_factory=list)
    popularity: float | None = None
    opening_hours: str | None = None
    brand: str | None = None
    location_is_approximate: bool = False
    details: PlaceDetailsSchema | None = None
    schedule_kind: Literal["fixed_start", "drop_in", "opening_hours"] = "fixed_start"
    recurrence: Literal["unknown", "one_off", "recurring"] = "unknown"
    final_day: str | None = None


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
    additional_options: list[AdditionalOptionResponse] = Field(default_factory=list)
    introduction: str = ""
    why_today: TodayReasonSchema | None = None
    prompt: str | None = None
    character: str | None = None


class WeatherResponse(BaseModel):
    summary: str
    temperature_f: int | None
    precipitation_probability: int
    is_wet: bool
    is_severe: bool
    source_name: str
    periods: list[WeatherPeriodSchema] = Field(default_factory=list)
    assumed: bool = False


class GenerationResponse(BaseModel):
    weather: WeatherResponse
    plans: list[ItineraryPlanResponse]
    warnings: list[str]
    generated_at: datetime
    data_mode: Literal["fixture", "live"]
    snapshot_token: str | None = None
    candidate_context: list[CandidateResponse] | None = None
    swap_token: str | None = None


class DiscoveryCard(BaseModel):
    label: str
    step: TimelineStepResponse


class DiscoveryResponse(BaseModel):
    cards: list[DiscoveryCard]
    weather: WeatherResponse
    warnings: list[str]
    generated_at: datetime
    data_mode: Literal["fixture", "live"]


class RemixRequest(BaseModel):
    brief: GenerateRequest
    generation: GenerationResponse
    swap_token: str = Field(min_length=20, max_length=200)
    plan_id: str
    locked_candidate_ids: list[str] = Field(default_factory=list, max_length=3)
    excluded_candidate_ids: list[str] = Field(default_factory=list, max_length=200)
    seen_candidate_ids: list[str] = Field(default_factory=list, max_length=200)
    visited_candidate_ids: list[str] = Field(default_factory=list, max_length=200)
    discovery_mode: DiscoveryMode = "new"
    completed_candidate_ids: list[str] = Field(default_factory=list, max_length=3)
    continue_outing: bool = False
    current_coordinates: CoordinatesSchema | None = None
    current_location_label: str | None = Field(default=None, max_length=160)


class RemixResponse(BaseModel):
    brief: GenerateRequest
    generation: GenerationResponse


class ApplyOptionRequest(BaseModel):
    brief: GenerateRequest
    generation: GenerationResponse
    swap_token: str = Field(min_length=20, max_length=200)
    plan_id: str = Field(min_length=1, max_length=120)
    option_id: str = Field(min_length=1, max_length=120)


class SharedBrief(BaseModel):
    start_at: datetime
    available_minutes: int
    budget_min: float
    budget_max: float
    group_size: int
    transport_mode: TransportMode
    radius_miles: float
    mood: Mood
    moods: list[Mood] = Field(default_factory=list, max_length=3)


class CreateShareRequest(BaseModel):
    brief: GenerateRequest
    generation: GenerationResponse
    snapshot_token: str = Field(min_length=20, max_length=200)
    selected_plan_id: str = Field(min_length=1, max_length=120)


class CreateShareResponse(BaseModel):
    id: str
    path: str
    expires_at: datetime


class SharedItineraryResponse(BaseModel):
    id: str
    brief: SharedBrief
    generation: GenerationResponse
    selected_plan_id: str
    created_at: datetime
    expires_at: datetime
