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
export type DiscoveryMode = "easy" | "new" | "surprise";

export interface PlaceDetails {
  description: string;
  activity: string;
  neighborhood: string;
  borough: string;
  price_status: "free" | "verified" | "estimated" | "unknown";
  registration?: string | null;
  source_urls: string[];
  reviewed_at?: string | null;
  signature: boolean;
  prompt?: string | null;
}

export interface TodayReason { kind: string; text: string; source_url?: string | null }

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
  centerpiece_id?: string | null;
  discovery_mode?: DiscoveryMode;
  seen_candidate_ids?: string[];
  visited_candidate_ids?: string[];
  excluded_candidate_ids?: string[];
  locked_candidate_ids?: string[];
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
  details?: PlaceDetails | null;
  why_today?: TodayReason | null;
  schedule_kind?: "fixed_start" | "drop_in" | "opening_hours" | null;
  window_start_at?: string | null;
  window_end_at?: string | null;
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
  additional_options?: AdditionalOption[];
  introduction?: string;
  why_today?: TodayReason | null;
  prompt?: string | null;
  character?: string | null;
}

export interface AdditionalOption {
  id: string;
  replaces_candidate_id: string;
  step: TimelineStep;
  total_minutes: number;
  total_cost_low: number;
  total_cost_high: number;
  confidence: number;
}

export interface CandidateData {
  id: string;
  name: string;
  category: string;
  mood_tags: string[];
  coordinates: Coordinates;
  duration_minutes: number;
  cost_low: number;
  cost_high: number;
  indoor: boolean | null;
  source_name: string;
  source_url: string | null;
  confidence: number;
  start_at?: string | null;
  end_at?: string | null;
  estimate_notes?: string[];
  popularity?: number | null;
  opening_hours?: string | null;
  brand?: string | null;
  location_is_approximate?: boolean;
  details?: PlaceDetails | null;
  schedule_kind?: "fixed_start" | "drop_in" | "opening_hours";
  recurrence?: "unknown" | "one_off" | "recurring";
  final_day?: string | null;
}

export interface GenerationResponse {
  weather: {
    summary: string;
    temperature_f: number | null;
    precipitation_probability: number;
    is_wet: boolean;
    is_severe: boolean;
    source_name: string;
    periods?: { start_at: string; end_at: string; precipitation_probability: number; is_severe: boolean }[];
    assumed?: boolean;
  };
  plans: ItineraryPlan[];
  warnings: string[];
  generated_at: string;
  data_mode: "fixture" | "live";
  snapshot_token: string | null;
  candidate_context?: CandidateData[] | null;
  swap_token?: string | null;
}

export interface DiscoveryResponse {
  cards: { label: string; step: TimelineStep }[];
  weather: GenerationResponse["weather"];
  warnings: string[];
  generated_at: string;
  data_mode: "fixture" | "live";
}

export interface RemixRequest {
  brief: GenerateRequest;
  generation: GenerationResponse;
  swap_token: string;
  plan_id: string;
  locked_candidate_ids: string[];
  excluded_candidate_ids: string[];
  seen_candidate_ids: string[];
  visited_candidate_ids: string[];
  discovery_mode: DiscoveryMode;
  completed_candidate_ids: string[];
  continue_outing: boolean;
  current_coordinates?: Coordinates;
  current_location_label?: string;
}

export interface RemixResponse { brief: GenerateRequest; generation: GenerationResponse }

export interface ApplyOptionRequest {
  brief: GenerateRequest;
  generation: GenerationResponse;
  swap_token: string;
  plan_id: string;
  option_id: string;
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
