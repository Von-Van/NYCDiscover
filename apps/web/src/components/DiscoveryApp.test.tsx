import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoResponse } from "@/lib/demo-data";
import type { GenerateRequest } from "@/lib/api-types";
import { DiscoveryApp } from "./DiscoveryApp";

vi.mock("./ItineraryMap", () => ({
  ItineraryMap: () => <div aria-label="Itinerary map" />,
}));

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
  regeneration_seed: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DiscoveryApp", () => {
  it("shows form validation without making a request", () => {
    render(<DiscoveryApp />);
    fireEvent.click(screen.getByRole("button", { name: /Make my plan/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a starting location.");
  });

  it("handles geolocation permission denial", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(
          (_success: PositionCallback, failure: PositionErrorCallback) =>
            failure({ code: 1, message: "denied" } as GeolocationPositionError),
        ),
      },
    });
    render(<DiscoveryApp />);
    fireEvent.click(screen.getByRole("button", { name: /Use my current location/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Location permission was not granted",
    );
  });

  it("renders loading, timeline, and estimate labels", async () => {
    let resolveGenerate!: (response: Response) => void;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (String(input).includes("/v1/geocode")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: [{ label: "Upper West Side, New York, NY", latitude: 40.787, longitude: -73.9754 }],
              warnings: [],
            }),
            { status: 200 },
          ),
        );
      }
      return new Promise<Response>((resolve) => {
        resolveGenerate = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscoveryApp />);

    fireEvent.change(screen.getByLabelText("Neighborhood, landmark, or address"), {
      target: { value: "Upper West Side" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    await screen.findByText("Starting point set.");
    fireEvent.click(screen.getByRole("button", { name: /Make my plan/ }));
    expect(screen.getByRole("heading", { name: "Finding the version of tonight that fits." })).toBeVisible();

    resolveGenerate(
      new Response(JSON.stringify(buildDemoResponse(request)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(await screen.findByRole("heading", { name: "Here’s your way out the door." })).toBeVisible();
    expect(screen.getAllByText("What to verify").length).toBeGreaterThan(0);
    expect(screen.getByText("NOT TURN-BY-TURN")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
