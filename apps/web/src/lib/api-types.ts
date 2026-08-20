export type Mood =
  | "social"
  | "relaxing"
  | "outdoors"
  | "date-night"
  | "productive"
  | "chaotic"
  | "low-energy"
  | "cultural"
  | "food-focused";

export type TransportMode = "walk" | "bike" | "transit";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GenerateRequest {
  location_label: string;
  coordinates: Coordinates;
  start_at: string;
  available_minutes: number;
  budget_min: number;
  budget_max: number;
  group_size: number;
  transport_mode: TransportMode;
  radius_miles: number;
  mood: Mood;
  moods: Mood[];
  regeneration_seed: number;
}

export interface TravelLeg {
  mode: string;
  minutes: number;
  distance_miles: number;
  from_label: string;
  to_label: string;
  estimate_note: string;
}

export interface TimelineStep {
  candidate_id: string;
  name: string;
  category: string;
  start_at: string;
  end_at: string;
  coordinates: Coordinates;
  cost_low: number;
  cost_high: number;
  confidence: number;
  source_name: string;
  source_url: string | null;
  estimate_notes: string[];
  travel_before: TravelLeg;
}

export interface ItineraryPlan {
  id: string;
  title: string;
  subtitle: string;
  score: number;
  confidence: number;
  total_minutes: number;
  total_cost_low: number;
  total_cost_high: number;
  steps: TimelineStep[];
  estimate_notes: string[];
}

export interface GenerationResponse {
  weather: {
    summary: string;
    temperature_f: number | null;
    precipitation_probability: number;
    is_wet: boolean;
    is_severe: boolean;
    source_name: string;
  };
  plans: ItineraryPlan[];
  warnings: string[];
  generated_at: string;
  data_mode: "fixture" | "live";
  snapshot_token: string | null;
}

export interface SharedBrief {
  start_at: string;
  available_minutes: number;
  budget_min: number;
  budget_max: number;
  group_size: number;
  transport_mode: TransportMode;
  radius_miles: number;
  mood: Mood;
  moods: Mood[];
}

export interface CreateShareRequest {
  brief: GenerateRequest;
  generation: GenerationResponse;
  snapshot_token: string;
  selected_plan_id: string;
}

export interface CreateShareResponse {
  id: string;
  path: string;
  expires_at: string;
}

export interface SharedItineraryResponse {
  id: string;
  brief: SharedBrief;
  generation: GenerationResponse;
  selected_plan_id: string;
  created_at: string;
  expires_at: string;
}

export interface GeocodeResponse {
  results: Array<{ label: string; latitude: number; longitude: number }>;
  warnings: string[];
}
