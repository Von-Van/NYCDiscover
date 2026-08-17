import { describe, expect, it } from "vitest";
import type { ItineraryPlan } from "./api-types";
import { getPlanComparisonLabels } from "./plan-comparison";

function plan(
  id: string,
  score: number,
  cost: number,
  travelMinutes: number,
  confidence: number,
): ItineraryPlan {
  return {
    id,
    title: id,
    subtitle: id,
    score,
    confidence,
    total_minutes: 120,
    total_cost_low: Math.max(0, cost - 5),
    total_cost_high: cost,
    estimate_notes: [],
    steps: [
      {
        candidate_id: `${id}-stop`,
        name: id,
        category: "test",
        start_at: "2026-08-14T18:00:00.000Z",
        end_at: "2026-08-14T19:00:00.000Z",
        coordinates: { latitude: 40.7, longitude: -73.9 },
        cost_low: 0,
        cost_high: cost,
        confidence,
        source_name: "test",
        source_url: null,
        estimate_notes: [],
        travel_before: {
          mode: "walk",
          minutes: travelMinutes,
          distance_miles: 0.5,
          from_label: "origin",
          to_label: id,
          estimate_note: "test",
        },
      },
    ],
  };
}

describe("getPlanComparisonLabels", () => {
  it("assigns at most one accurate label to each plan in precedence order", () => {
    const labels = getPlanComparisonLabels([
      plan("overall", 0.95, 30, 12, 0.7),
      plan("budget", 0.8, 10, 8, 0.98),
      plan("short", 0.75, 25, 3, 0.82),
    ]);

    expect([...labels.entries()]).toEqual([
      ["overall", "Best overall"],
      ["budget", "Lowest cost"],
      ["short", "Least travel"],
    ]);
  });

  it("uses stable response order to resolve ties", () => {
    const labels = getPlanComparisonLabels([
      plan("first", 0.8, 20, 5, 0.8),
      plan("second", 0.8, 20, 5, 0.8),
    ]);

    expect([...labels.entries()]).toEqual([["first", "Best overall"]]);
  });
});
