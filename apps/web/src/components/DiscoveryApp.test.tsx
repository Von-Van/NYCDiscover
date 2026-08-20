import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoResponse } from "@/lib/demo-data";
import type { GenerateRequest } from "@/lib/api-types";
import { DiscoveryApp } from "./DiscoveryApp";

vi.mock("./ItineraryMap", () => ({
  ItineraryMap: ({
    activeStepId,
    onStepPreview,
    onStepSelect,
  }: {
    activeStepId?: string | null;
    onStepPreview?: (stepId: string | null) => void;
    onStepSelect?: (stepId: string) => void;
  }) => (
    <div aria-label="Itinerary map" data-active-step={activeStepId ?? ""}>
      <button onMouseEnter={() => onStepPreview?.("demo-dessert")}>Preview dessert marker</button>
      <button onClick={() => onStepSelect?.("demo-dessert")}>Select dessert marker</button>
    </div>
  ),
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
  moods: ["social"],
  regeneration_seed: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function createSuccessfulFetch() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
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
    const submittedRequest = JSON.parse(String(init?.body)) as GenerateRequest;
    return Promise.resolve(
      new Response(JSON.stringify(buildDemoResponse(submittedRequest)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

async function generatePlan() {
  fireEvent.change(screen.getByLabelText("Neighborhood, landmark, or address"), {
    target: { value: "Upper West Side" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Set" }));
  await screen.findByText("Starting point set.");
  fireEvent.click(screen.getByRole("button", { name: /Make my plan/ }));
  await screen.findByRole("heading", { name: "Here’s your way out the door." });
}

describe("DiscoveryApp", () => {
  it("allows up to three moods while keeping one selected", () => {
    render(<DiscoveryApp />);

    const social = screen.getByRole("button", { name: "Social" });
    const cultural = screen.getByRole("button", { name: "Cultural" });
    const foodFocused = screen.getByRole("button", { name: "Food-focused" });
    const relaxing = screen.getByRole("button", { name: "Relaxing" });

    fireEvent.click(cultural);
    fireEvent.click(foodFocused);
    expect(social).toHaveAttribute("aria-pressed", "true");
    expect(cultural).toHaveAttribute("aria-pressed", "true");
    expect(foodFocused).toHaveAttribute("aria-pressed", "true");
    expect(relaxing).toBeDisabled();

    fireEvent.click(social);
    expect(relaxing).toBeEnabled();
    fireEvent.click(foodFocused);
    fireEvent.click(cultural);
    expect(cultural).toHaveAttribute("aria-pressed", "true");
  });

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
    expect(screen.getByText("Fixture demonstration")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("discards unsubmitted inspector edits and keeps result facts committed", async () => {
    vi.stubGlobal("fetch", createSuccessfulFetch());
    render(<DiscoveryApp />);
    await generatePlan();

    const travelFact = screen.getByText("Travel").closest("div");
    expect(travelFact).toHaveTextContent("walk");
    fireEvent.click(screen.getByRole("button", { name: "Change the brief" }));
    fireEvent.click(screen.getByRole("button", { name: "transit" }));
    expect(travelFact).toHaveTextContent("walk");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Change the brief" }));
    expect(screen.getByRole("button", { name: "walk" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "transit" })).toHaveAttribute("aria-pressed", "false");
  });

  it("commits inspector edits only after a successful update", async () => {
    const fetchMock = createSuccessfulFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<DiscoveryApp />);
    await generatePlan();

    fireEvent.click(screen.getByRole("button", { name: "Change the brief" }));
    fireEvent.click(screen.getByRole("button", { name: "transit" }));
    fireEvent.change(screen.getByLabelText("Maximum per-person budget"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Update plans/ }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "The brief" })).not.toBeInTheDocument());
    expect(screen.getByText("Travel").closest("div")).toHaveTextContent("transit");
    const generationCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/v1/itineraries/generate"),
    );
    const lastRequest = JSON.parse(String(generationCalls.at(-1)?.[1]?.body)) as GenerateRequest;
    expect(lastRequest.transport_mode).toBe("transit");
    expect(lastRequest.budget_max).toBe(60);
  });

  it("preserves the visible itinerary when an inspector update fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_FALLBACK", "false");
    let generationCount = 0;
    const fetchMock = createSuccessfulFetch();
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("/v1/itineraries/generate")) {
        generationCount += 1;
        if (generationCount > 1) return Promise.reject(new Error("API down"));
      }
      return fetchMock(input, init);
    }));
    render(<DiscoveryApp />);
    await generatePlan();

    fireEvent.click(screen.getByRole("button", { name: "Change the brief" }));
    fireEvent.click(screen.getByRole("button", { name: "transit" }));
    fireEvent.click(screen.getByRole("button", { name: /Update plans/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("API down");
    expect(screen.getByRole("heading", { name: "The brief" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Trivia + Dessert" })).toBeVisible();
    expect(screen.getByText("Travel").closest("div")).toHaveTextContent("walk");
  });

  it("synchronizes map preview and selection with the timeline", async () => {
    vi.stubGlobal("fetch", createSuccessfulFetch());
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(<DiscoveryApp />);
    await generatePlan();

    const secondStop = screen.getByRole("button", { name: /Show stop 2/ }).closest("li");
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Preview dessert marker" }));
    expect(secondStop).toHaveClass("active");
    fireEvent.click(screen.getByRole("button", { name: "Select dessert marker" }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(secondStop).toHaveClass("active");
  });

  it("creates and copies a signed seven-day share link", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    const fetchMock = createSuccessfulFetch();
    const routedFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/v1/shares")) {
        return new Response(
          JSON.stringify({ id: "share-id", path: "/share/share-id", expires_at: new Date().toISOString() }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      if (String(input).includes("/v1/itineraries/generate")) {
        const submitted = JSON.parse(String(init?.body)) as GenerateRequest;
        return new Response(
          JSON.stringify({ ...buildDemoResponse(submitted), data_mode: "live", snapshot_token: "signed.snapshot-token" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return fetchMock(input, init);
    });
    vi.stubGlobal("fetch", routedFetch);
    render(<DiscoveryApp />);
    await generatePlan();

    expect(screen.getByText("Live data beta")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Share plan" }));
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeVisible();
    expect(clipboard.writeText).toHaveBeenCalledWith("http://localhost:3000/share/share-id");

    const shareCall = routedFetch.mock.calls.find(([input]) => String(input).endsWith("/v1/shares"));
    const body = JSON.parse(String(shareCall?.[1]?.body));
    expect(body.snapshot_token).toBe("signed.snapshot-token");
    expect(body.selected_plan_id).toBe("plan-1");
    expect(body.brief.location_label).toContain("Upper West Side");
    expect(body.generation.plans).toHaveLength(3);
  });
});
