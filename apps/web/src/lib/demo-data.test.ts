import { describe, expect, it } from "vitest";
import { buildDemoResponse } from "./demo-data";
import type { GenerateRequest } from "./api-types";

const request: GenerateRequest = {
  location_label: "Upper West Side",
  coordinates: { latitude: 40.787, longitude: -73.9754 },
  start_at: new Date().toISOString(),
  available_minutes: 240,
  budget_min: 0,
  budget_max: 40,
  group_size: 2,
  transport_mode: "walk",
  radius_miles: 2,
  mood: "social",
  moods: ["social"],
  regeneration_seed: 0,
};

describe("demo response", () => {
  it("only returns feasible plans", () => {
    const response = buildDemoResponse(request);
    expect(response.plans.length).toBeGreaterThan(0);
    for (const plan of response.plans) {
      expect(plan.total_minutes).toBeLessThanOrEqual(request.available_minutes);
      expect(plan.total_cost_high).toBeLessThanOrEqual(request.budget_max);
    }
  });
});
