import { describe, expect, it } from "vitest";
import { toGenerateRequest, validateForm, type DiscoveryForm } from "./form";

const validForm: DiscoveryForm = {
  locationLabel: "Upper West Side",
  coordinates: { latitude: 40.787, longitude: -73.9754 },
  startMode: "now",
  laterTime: "19:00",
  availableMinutes: 240,
  budgetMax: 40,
  groupSize: 2,
  transportMode: "walk",
  radiusMiles: 2,
  mood: "social",
};

describe("discovery form", () => {
  it("requires a resolved location", () => {
    expect(validateForm({ ...validForm, coordinates: null })).toContain("Choose a starting location.");
  });

  it("creates the public API request shape", () => {
    const request = toGenerateRequest(validForm, 7);
    expect(request.location_label).toBe("Upper West Side");
    expect(request.regeneration_seed).toBe(7);
    expect(request.budget_max).toBe(40);
  });
});

