import type { Coordinates, GenerateRequest, Mood, TransportMode } from "./api-types";

export interface DiscoveryForm {
  locationLabel: string;
  coordinates: Coordinates | null;
  startMode: "now" | "later";
  laterTime: string;
  availableMinutes: number;
  budgetMax: number;
  groupSize: number;
  transportMode: TransportMode;
  radiusMiles: number;
  mood: Mood;
}

export function validateForm(form: DiscoveryForm): string[] {
  const errors: string[] = [];
  if (!form.locationLabel.trim() || !form.coordinates) errors.push("Choose a starting location.");
  if (form.availableMinutes < 60) errors.push("Set aside at least one hour.");
  if (form.budgetMax < 0) errors.push("Budget cannot be negative.");
  if (form.groupSize < 1) errors.push("Group size must be at least one.");
  if (form.startMode === "later" && !form.laterTime) errors.push("Choose a start time for today.");
  return errors;
}

export function toGenerateRequest(form: DiscoveryForm, regenerationSeed: number): GenerateRequest {
  if (!form.coordinates) throw new Error("A starting location is required.");
  const start = new Date();
  if (form.startMode === "later") {
    const [hours, minutes] = form.laterTime.split(":").map(Number);
    start.setHours(hours, minutes, 0, 0);
  }
  return {
    location_label: form.locationLabel,
    coordinates: form.coordinates,
    start_at: start.toISOString(),
    available_minutes: form.availableMinutes,
    budget_min: 0,
    budget_max: form.budgetMax,
    group_size: form.groupSize,
    transport_mode: form.transportMode,
    radius_miles: form.radiusMiles,
    mood: form.mood,
    regeneration_seed: regenerationSeed,
  };
}

