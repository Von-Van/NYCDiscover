import type {
  GenerateRequest,
  GenerationResponse,
  ItineraryPlan,
  TimelineStep,
} from "./api-types";

function isoAfter(start: Date, minutes: number) {
  return new Date(start.getTime() + minutes * 60_000).toISOString();
}

function step(
  request: GenerateRequest,
  id: string,
  name: string,
  category: string,
  offset: number,
  duration: number,
  cost: [number, number],
  coords: [number, number],
  fromLabel: string,
  travelMinutes: number,
): TimelineStep {
  const start = new Date(request.start_at);
  return {
    candidate_id: id,
    name,
    category,
    start_at: isoAfter(start, offset),
    end_at: isoAfter(start, offset + duration),
    coordinates: { latitude: coords[0], longitude: coords[1] },
    cost_low: cost[0],
    cost_high: cost[1],
    confidence: 0.78,
    source_name: "Fixture place",
    source_url: null,
    estimate_notes: ["Cost and duration are category-based estimates."],
    travel_before: {
      mode: request.transport_mode,
      minutes: travelMinutes,
      distance_miles: Math.max(0.2, travelMinutes / 20),
      from_label: fromLabel,
      to_label: name,
      estimate_note: "Mode-aware estimate; verify before leaving.",
    },
  };
}

function makePlan(
  request: GenerateRequest,
  id: string,
  title: string,
  subtitle: string,
  steps: TimelineStep[],
): ItineraryPlan {
  const end = new Date(steps.at(-1)!.end_at).getTime();
  const start = new Date(request.start_at).getTime();
  return {
    id,
    title,
    subtitle,
    score: 0.82,
    confidence: steps.reduce((sum, item) => sum + item.confidence, 0) / steps.length,
    total_minutes: Math.round((end - start) / 60_000),
    total_cost_low: steps.reduce((sum, item) => sum + item.cost_low, 0),
    total_cost_high: steps.reduce((sum, item) => sum + item.cost_high, 0),
    steps,
    estimate_notes: [
      "Costs are estimated per person.",
      "Travel times are mode-aware estimates, not turn-by-turn routes.",
    ],
  };
}

export function buildDemoResponse(request: GenerateRequest): GenerationResponse {
  const origin = request.location_label;
  const socialSteps = [
    step(request, "demo-trivia", "Neighborhood trivia table", "trivia", 20, 80, [8, 16], [40.7872, -73.9755], origin, 8),
    step(request, "demo-dessert", "Late-night cookie stop", "dessert", 115, 25, [4, 9], [40.7858, -73.9721], "Neighborhood trivia table", 7),
  ];
  const culturalSteps = [
    step(request, "demo-roerich", "Nicholas Roerich Museum", "museum", 15, 60, [0, 0], [40.8029, -73.9683], origin, 13),
    step(request, "demo-noodles", "Hand-pulled noodles and dumplings", "restaurant", 92, 55, [14, 24], [40.7992, -73.9671], "Nicholas Roerich Museum", 7),
  ];
  const nightSteps = [
    step(request, "demo-bookstore", "Book Culture browse", "bookstore", 15, 42, [0, 12], [40.8063, -73.9652], origin, 15),
    step(request, "demo-comedy", "Basement stand-up showcase", "comedy", 82, 75, [12, 20], [40.7835, -73.9794], "Book Culture browse", 22),
  ];
  const plans = [
    makePlan(request, "plan-1", "Trivia + Dessert", "Easy company", socialSteps),
    makePlan(request, "plan-2", "Museum + Food", "A cultured detour", culturalSteps),
    makePlan(request, "plan-3", "Bookstore + Comedy", "A little plot twist", nightSteps),
  ].filter((plan) => plan.total_minutes <= request.available_minutes && plan.total_cost_high <= request.budget_max);
  return {
    weather: {
      summary: "Partly sunny, comfortable later",
      temperature_f: 72,
      precipitation_probability: 12,
      is_wet: false,
      is_severe: false,
      source_name: "Fixture weather",
    },
    plans,
    warnings: ["Demo data is shown because the local API is unavailable."],
    generated_at: new Date().toISOString(),
  };
}

