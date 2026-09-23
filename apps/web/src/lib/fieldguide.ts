import { track } from "@vercel/analytics";
import type { TimelineStep, TransportMode } from "./api-types";

export function priceLabel(step: TimelineStep) {
  if (step.details?.price_status === "free" && step.cost_high === 0) return "Free to visit";
  if (step.details?.price_status === "unknown") return `Price unconfirmed · allow up to $${step.cost_high}`;
  return `${step.details?.price_status === "verified" ? "" : "Est. "}$${step.cost_low}–${step.cost_high}`;
}

export function directionsUrl(step: TimelineStep, mode: TransportMode) {
  const parameters = new URLSearchParams({ api: "1", destination: `${step.coordinates.latitude},${step.coordinates.longitude}`, travelmode: { walk: "walking", bike: "bicycling", transit: "transit" }[mode] });
  return `https://www.google.com/maps/dir/?${parameters}`;
}

// The closed event vocabulary cannot carry places, coordinates, histories, or share IDs.
export function fieldguideEvent(name: "discovery_selected" | "generation_succeeded" | "outing_started" | "outing_went" | "outing_did_not_go" | "discovered_somewhere_new" | "outing_familiar") {
  try { track(name); } catch { /* Analytics never blocks the outing. */ }
}
