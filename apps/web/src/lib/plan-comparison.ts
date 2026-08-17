import type { ItineraryPlan } from "./api-types";

export type PlanComparisonLabel =
  | "Best overall"
  | "Lowest cost"
  | "Least travel"
  | "Highest confidence";

function winnerIndex(plans: ItineraryPlan[], value: (plan: ItineraryPlan) => number, mode: "min" | "max") {
  if (plans.length === 0) return -1;
  return plans.reduce((winner, plan, index) => {
    const comparison = value(plan) - value(plans[winner]);
    return mode === "max" ? (comparison > 0 ? index : winner) : comparison < 0 ? index : winner;
  }, 0);
}

export function getPlanComparisonLabels(plans: ItineraryPlan[]) {
  const labels = new Map<string, PlanComparisonLabel>();
  const candidates: Array<[number, PlanComparisonLabel]> = [
    [winnerIndex(plans, (plan) => plan.score, "max"), "Best overall"],
    [winnerIndex(plans, (plan) => plan.total_cost_high, "min"), "Lowest cost"],
    [
      winnerIndex(
        plans,
        (plan) => plan.steps.reduce((total, step) => total + step.travel_before.minutes, 0),
        "min",
      ),
      "Least travel",
    ],
    [winnerIndex(plans, (plan) => plan.confidence, "max"), "Highest confidence"],
  ];

  for (const [index, label] of candidates) {
    const plan = plans[index];
    if (plan && !labels.has(plan.id)) labels.set(plan.id, label);
  }
  return labels;
}
