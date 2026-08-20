import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { buildDemoResponse } from "@/lib/demo-data";
import type { GenerateRequest, SharedItineraryResponse } from "@/lib/api-types";
import { SharedItineraryApp } from "./SharedItineraryApp";

vi.mock("./ItineraryMap", () => ({
  ItineraryMap: ({ plan }: { plan: { title: string } }) => <div aria-label={`Map for ${plan.title}`} />,
}));

const request: GenerateRequest = {
  location_label: "Private origin",
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

function sharedResponse(): SharedItineraryResponse {
  const generation = buildDemoResponse(request);
  generation.plans.forEach((plan) => {
    plan.steps[0].travel_before.from_label = "Starting point";
  });
  return {
    id: "abcdefghijklmnopqrstuv",
    brief: {
      start_at: request.start_at,
      available_minutes: 240,
      budget_min: 0,
      budget_max: 40,
      group_size: 2,
      transport_mode: "walk",
      radius_miles: 2,
      mood: "social",
      moods: ["social"],
    },
    generation,
    selected_plan_id: "plan-2",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SharedItineraryApp", () => {
  it("opens the selected plan and keeps comparison switching read-only", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(sharedResponse()), { status: 200, headers: { "Content-Type": "application/json" } }),
    ));
    render(<SharedItineraryApp shareId="abcdefghijklmnopqrstuv" />);

    expect(await screen.findByRole("heading", { name: "A plan worth passing along." })).toBeVisible();
    expect(screen.getByRole("button", { name: /Plan B/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Private origin")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Regenerate|Change the brief/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Plan C/ }));
    expect(screen.getByRole("button", { name: /Plan C/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Map for Bookstore + Comedy")).toBeVisible();
  });

  it.each([
    [404, "That shared itinerary does not exist."],
    [410, "This seven-day itinerary has expired."],
  ])("shows a useful %s state", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new ApiError(message, status)));
    render(<SharedItineraryApp shareId="abcdefghijklmnopqrstuv" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: /Make your own plan/ })).toHaveAttribute("href", "/");
  });
});
