import { describe, expect, it } from "vitest";
import { applyDemoOption, buildDemoResponse } from "./demo-data";
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

  it.each([false, true])("applies the food-only exception to offline options: %s", (foodOnly) => {
    const brief = { ...request, mood: "food-focused" as const, moods: foodOnly ? ["food-focused" as const] : ["food-focused" as const, "social" as const] };
    const response = buildDemoResponse(brief);
    const plan = response.plans[0];
    const secondFood = plan.additional_options?.find((option) => option.replaces_candidate_id === "demo-trivia" && option.step.category === "cafe");
    expect(Boolean(secondFood)).toBe(foodOnly);
    if (secondFood) {
      const updated = applyDemoOption(brief, response, plan.id, secondFood.id);
      expect(updated.plans[0].steps.map((step) => step.category)).toEqual(["cafe", "dessert"]);
    }
  });
});
