import type {
  CandidateData,
  Coordinates,
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

const foodDrink = new Set(["restaurant", "cafe", "dessert", "bar"]);

function milesBetween(left: Coordinates, right: Coordinates) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitude = Math.sin(radians(right.latitude - left.latitude) / 2) ** 2;
  const longitude = Math.sin(radians(right.longitude - left.longitude) / 2) ** 2;
  const value = latitude + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * longitude;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

// This small scheduler is only for the offline sample catalog (which has no
// opening-hour rules). Live and API fixture swaps always use the Python engine.
function scheduleDemoPlan(request: GenerateRequest, plan: ItineraryPlan, route: CandidateData[]): ItineraryPlan | null {
  const selectedMoods = new Set(request.moods.length ? request.moods : [request.mood]);
  if (!(selectedMoods.size === 1 && selectedMoods.has("food-focused")) && route.filter((candidate) => foodDrink.has(candidate.category)).length > 1) return null;
  if (new Set(route.map((candidate) => candidate.id)).size !== route.length) return null;
  let current = new Date(request.start_at).getTime();
  let coordinates = request.coordinates;
  let fromLabel = request.location_label;
  const steps: TimelineStep[] = [];
  for (const candidate of route) {
    if (milesBetween(request.coordinates, candidate.coordinates) > request.radius_miles) return null;
    const distance = milesBetween(coordinates, candidate.coordinates);
    const [speed, buffer] = { walk: [2.9, 2], bike: [9.5, 4], transit: [11, 11] }[request.transport_mode];
    const minutes = distance <= 0.05 ? 2 : Math.max(3, Math.ceil(distance / speed * 60 + buffer));
    const arrival = current + minutes * 60_000;
    const start = candidate.start_at ? new Date(candidate.start_at).getTime() : arrival;
    const end = candidate.end_at ? new Date(candidate.end_at).getTime() : start + candidate.duration_minutes * 60_000;
    if (arrival > start || end <= start || end > new Date(request.start_at).getTime() + request.available_minutes * 60_000) return null;
    steps.push({
      candidate_id: candidate.id,
      name: candidate.name,
      category: candidate.category,
      coordinates: candidate.coordinates,
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      cost_low: candidate.cost_low,
      cost_high: candidate.cost_high,
      confidence: candidate.confidence,
      source_name: candidate.source_name,
      source_url: candidate.source_url,
      estimate_notes: candidate.estimate_notes ?? [],
      travel_before: {
        mode: request.transport_mode, minutes, distance_miles: Math.round(distance * 100) / 100,
        from_label: fromLabel, to_label: candidate.name,
        estimate_note: "Mode-aware estimate; verify before leaving.",
      },
    });
    current = end;
    coordinates = candidate.coordinates;
    fromLabel = candidate.name;
  }
  const labels: Record<string, string> = { restaurant: "Food", cafe: "Cafe" };
  const categoryLabel = (category: string) => labels[category] ?? category[0].toUpperCase() + category.slice(1);
  const title = steps.length === 1 ? categoryLabel(steps[0].category) : `${categoryLabel(steps[0].category)} + ${categoryLabel(steps.at(-1)!.category)}`;
  const updated = makePlan(request, plan.id, title, plan.subtitle, steps);
  return updated.total_cost_high <= request.budget_max ? updated : null;
}

function withDemoOptions(request: GenerateRequest, response: GenerationResponse): GenerationResponse {
  const candidates = response.candidate_context ?? [];
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected = new Set(response.plans.flatMap((plan) => plan.steps.map((step) => step.candidate_id)));
  return {
    ...response,
    plans: response.plans.map((plan) => ({
      ...plan,
      additional_options: plan.steps.flatMap((stop, index) => candidates.filter((candidate) => !selected.has(candidate.id)).flatMap((candidate) => {
        const route = plan.steps.map((step, stepIndex) => stepIndex === index ? candidate : byId.get(step.candidate_id)!);
        const preview = scheduleDemoPlan(request, plan, route);
        return preview ? [{
          id: `${plan.id}:${plan.steps.map((step) => step.candidate_id).join(",")}:${index}:${candidate.id}`,
          replaces_candidate_id: stop.candidate_id,
          step: preview.steps[index],
          total_minutes: preview.total_minutes,
          total_cost_low: preview.total_cost_low,
          total_cost_high: preview.total_cost_high,
          confidence: preview.confidence,
        }] : [];
      })),
    })),
  };
}

export function applyDemoOption(request: GenerateRequest, response: GenerationResponse, planId: string, optionId: string): GenerationResponse {
  if (response.data_mode !== "fixture" || response.snapshot_token || response.swap_token) throw new Error("This plan needs the API to update its route.");
  const plan = response.plans.find((plan) => plan.id === planId);
  const option = plan?.additional_options?.find((option) => option.id === optionId);
  if (!plan || !option) throw new Error("This option is no longer available.");
  const byId = new Map((response.candidate_context ?? []).map((candidate) => [candidate.id, candidate]));
  const route = plan.steps.map((step) => byId.get(step.candidate_id === option.replaces_candidate_id ? option.step.candidate_id : step.candidate_id)!);
  const updated = scheduleDemoPlan(request, plan, route);
  if (!updated) throw new Error("This option no longer fits your brief.");
  return withDemoOptions(request, { ...response, plans: response.plans.map((item) => item.id === planId ? updated : item) });
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
  ].filter((plan) => plan.total_minutes <= request.available_minutes && plan.total_cost_high <= request.budget_max && plan.steps.every((step) => milesBetween(request.coordinates, step.coordinates) <= request.radius_miles));
  const extraSteps = [
    step(request, "demo-gallery", "Neighborhood gallery visit", "gallery", 12, 35, [0, 0], [40.789, -73.975], origin, 5),
    step(request, "demo-cafe", "Window-seat cafe reset", "cafe", 10, 30, [5, 12], [40.791, -73.974], origin, 8),
    step(request, "demo-park", "Riverside Park stroll", "park", 10, 40, [0, 0], [40.79, -73.98], origin, 10),
  ];
  const candidates: CandidateData[] = [...socialSteps, ...culturalSteps, ...nightSteps, ...extraSteps].map((step) => ({
    id: step.candidate_id, name: step.name, category: step.category,
    mood_tags: [], coordinates: step.coordinates,
    duration_minutes: Math.round((new Date(step.end_at).getTime() - new Date(step.start_at).getTime()) / 60_000),
    cost_low: step.cost_low, cost_high: step.cost_high, indoor: step.category !== "park",
    source_name: step.source_name, source_url: step.source_url, confidence: step.confidence,
    estimate_notes: step.estimate_notes,
    start_at: ["trivia", "comedy"].includes(step.category) ? step.start_at : null,
    end_at: ["trivia", "comedy"].includes(step.category) ? step.end_at : null,
  }));
  return withDemoOptions(request, {
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
    data_mode: "fixture",
    snapshot_token: null,
    swap_token: null,
    candidate_context: candidates,
  });
}
