import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyItineraryOption, createShare, generateItineraries, geocodeLocation, discoverToday, remixItinerary } from "@/lib/api";
import { applyDemoOption, buildDemoResponse } from "@/lib/demo-data";
import type { GenerationResponse, ItineraryPlan } from "@/lib/api-types";
import { DiscoveryApp } from "./DiscoveryApp";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api")>(), discoverToday: vi.fn(), remixItinerary: vi.fn(),
  applyItineraryOption: vi.fn(), createShare: vi.fn(), generateItineraries: vi.fn(), geocodeLocation: vi.fn(),
}));
vi.mock("./ItineraryMap", () => ({
  ItineraryMap: ({ plan, activeStepId }: { plan: ItineraryPlan; activeStepId: string | null }) => (
    <div data-testid="map" data-active={activeStepId ?? ""} data-stops={plan.steps.map((step) => step.candidate_id).join(",")} />
  ),
}));

beforeEach(() => {
  vi.mocked(discoverToday).mockResolvedValue({ cards: [], weather: { summary: "Clear", temperature_f: 70, precipitation_probability: 0, is_wet: false, is_severe: false, source_name: "Fixture" }, warnings: [], generated_at: new Date().toISOString(), data_mode: "fixture" });
  vi.mocked(remixItinerary).mockImplementation(async ({ brief }) => ({ brief, generation: { ...buildDemoResponse(brief), swap_token: "options-remixed", snapshot_token: "share-remixed" } }));
  vi.mocked(geocodeLocation).mockResolvedValue({ results: [{ label: "Upper West Side", latitude: 40.787, longitude: -73.9754 }], warnings: [] });
  vi.mocked(generateItineraries).mockImplementation(async (request) => ({
    ...buildDemoResponse(request), swap_token: "options-original", snapshot_token: "share-original",
  }));
  vi.mocked(createShare).mockResolvedValue({ id: "share-id", path: "/share/share-id", expires_at: new Date().toISOString() });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

async function generate() {
  render(<DiscoveryApp />);
  fireEvent.change(screen.getByLabelText("Neighborhood, landmark, or address"), { target: { value: "Upper West Side" } });
  fireEvent.click(screen.getByRole("button", { name: "Set" }));
  await screen.findByText("Starting point set.");
  fireEvent.click(screen.getByRole("button", { name: /Make my plan/ }));
  await screen.findByRole("heading", { name: "Here’s your way out the door." });
}

function swappedResponse(): GenerationResponse {
  const payload = vi.mocked(applyItineraryOption).mock.calls.at(-1)![0];
  return {
    ...applyDemoOption(payload.brief, { ...payload.generation, snapshot_token: null, swap_token: null }, payload.plan_id, payload.option_id),
    swap_token: "options-updated", snapshot_token: "share-updated",
  };
}

describe("Additional Options in the workspace", () => {
  it("updates the route, preserves other plans, and shares the customized snapshot", async () => {
    let finish!: (value: GenerationResponse) => void;
    vi.mocked(applyItineraryOption).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Share plan" }));
    await screen.findByRole("button", { name: "Link copied" });
    const menu = screen.getByRole("button", { name: /Additional Options/ });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Swap in/ })).not.toBeInTheDocument();
    fireEvent.click(menu);
    const swap = screen.getByRole("button", { name: "Swap in Neighborhood gallery visit for Neighborhood trivia table" });
    fireEvent.click(swap);
    fireEvent.click(swap);
    expect(applyItineraryOption).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Plan B/ })).toBeDisabled();
    expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "demo-trivia,demo-dessert");
    const updated = swappedResponse();
    finish(updated);
    await screen.findByText(/Neighborhood gallery visit replaced Neighborhood trivia table/);
    expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "demo-gallery,demo-dessert");
    expect(screen.getByTestId("map")).toHaveAttribute("data-active", "");
    await waitFor(() => expect(menu).toHaveFocus());
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("link", { name: /share-id/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Plan B/ }));
    expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "demo-roerich,demo-noodles");
    fireEvent.click(screen.getByRole("button", { name: /Plan A/ }));
    expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "demo-gallery,demo-dessert");
    fireEvent.click(screen.getByRole("button", { name: "Share plan" }));
    await screen.findByRole("button", { name: "Link copied" });
    const share = vi.mocked(createShare).mock.calls.at(-1)![0];
    expect(share.snapshot_token).toBe("share-updated");
    expect(share.generation.plans[0]).toEqual(updated.plans[0]);
    expect(share.selected_plan_id).toBe("plan-1");
    expect(within(screen.getByText("Est. spend").parentElement!).getByText(`$${updated.plans[0].total_cost_low}–$${updated.plans[0].total_cost_high}`)).toBeVisible();
  });

  it("keeps the current itinerary after failure and supports retry followed by another swap", async () => {
    await generate();
    fireEvent.click(screen.getByRole("button", { name: /Additional Options/ }));
    vi.mocked(applyItineraryOption).mockRejectedValueOnce(new Error("Please try again shortly."));
    fireEvent.click(screen.getByRole("button", { name: "Swap in Neighborhood gallery visit for Neighborhood trivia table" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again shortly.");
    expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "demo-trivia,demo-dessert");
    vi.mocked(applyItineraryOption).mockImplementation(async () => swappedResponse());
    fireEvent.click(screen.getByRole("button", { name: "Swap in Neighborhood gallery visit for Neighborhood trivia table" }));
    await screen.findByText(/Neighborhood gallery visit replaced/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Swap in Window-seat cafe reset for Late-night cookie stop" }));
    await screen.findByText(/Window-seat cafe reset replaced/);
    expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "demo-gallery,demo-cafe");
    expect(vi.mocked(applyItineraryOption).mock.calls.at(-1)![0].swap_token).toBe("options-updated");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "demo-trivia,demo-dessert"));
  });

  it("provides an empty state when no unused stops fit", async () => {
    vi.mocked(generateItineraries).mockImplementation(async (request) => {
      const response = buildDemoResponse(request);
      return { ...response, swap_token: "signed", plans: response.plans.map((plan) => ({ ...plan, additional_options: [] })) };
    });
    await generate();
    fireEvent.click(screen.getByRole("button", { name: /Additional Options/ }));
    expect(screen.getByText(/No other stops fit these plans/)).toBeVisible();
  });

  it("supports offline sample swaps without sending unsigned plans to the API", async () => {
    vi.mocked(generateItineraries).mockRejectedValue(new Error("Offline"));
    await generate();
    fireEvent.click(screen.getByRole("button", { name: /Additional Options/ }));
    fireEvent.click(screen.getByRole("button", { name: "Swap in Neighborhood gallery visit for Neighborhood trivia table" }));
    await screen.findByText(/Neighborhood gallery visit replaced/);
    expect(applyItineraryOption).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Share plan" })).not.toBeInTheDocument();
  });
});

describe("Daily field guide controls", () => {
  it("keeps a chosen stop through signed regeneration and records a failed dismissal", async () => {
    await generate();
    fireEvent.click(screen.getAllByRole("button", { name: "Keep this stop" })[0]);
    expect(screen.getByRole("button", { name: /Plan B/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(remixItinerary).toHaveBeenCalledTimes(1));
    expect(vi.mocked(remixItinerary).mock.calls[0][0].locked_candidate_ids).toEqual(["demo-trivia"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled());
    vi.mocked(remixItinerary).mockRejectedValueOnce(new Error("No alternative fits."));
    fireEvent.click(screen.getAllByRole("button", { name: "Show another idea" })[1]);
    expect(await screen.findByRole("alert")).toHaveTextContent("No alternative fits.");
    expect(screen.getByTestId("map")).toHaveAttribute("data-stops", "demo-trivia,demo-dessert");
    const { getDiscoverySession } = await import("@/lib/discovery-session");
    expect(getDiscoverySession().excluded).toContain("demo-dessert");
    fireEvent.click(screen.getByRole("button", { name: "Reset this session" }));
    expect(getDiscoverySession().excluded).toEqual([]);
    expect(getDiscoverySession().locked).toEqual([]);
  });

  it("keeps completed stops fixed when returning from Now / Next to the full plan", async () => {
    await generate();
    fireEvent.click(screen.getByRole("button", { name: /Start this outing/ }));
    expect(screen.getByRole("heading", { name: "One good stop at a time." })).toBeVisible();
    expect(screen.getByRole("link", { name: /Get directions/ })).toHaveAttribute("href", expect.stringContaining("google.com/maps/dir/?api=1"));
    fireEvent.click(screen.getByRole("button", { name: /Mark stop complete/ }));
    expect(screen.getByRole("heading", { name: "Late-night cookie stop" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "See the whole plan" }));
    expect(screen.getByRole("button", { name: "Change the brief" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Plan B/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(remixItinerary).toHaveBeenCalledTimes(1));
    expect(vi.mocked(remixItinerary).mock.calls[0][0]).toMatchObject({
      continue_outing: true, completed_candidate_ids: ["demo-trivia"],
    });
  });

  it("uses a discovery card as the required centerpiece", async () => {
    const { toGenerateRequest } = await import("@/lib/form");
    const { initialDiscoveryForm } = await import("./BriefFields");
    const example = buildDemoResponse(toGenerateRequest({ ...initialDiscoveryForm, coordinates: { latitude:40.787,longitude:-73.9754 }, locationLabel:"Upper West Side" },0));
    vi.mocked(discoverToday).mockResolvedValue({ cards: [{ label:"Starting soon", step:example.plans[0].steps[0] }], weather:example.weather, warnings:[], generated_at:new Date().toISOString(), data_mode:"fixture" });
    render(<DiscoveryApp />);
    fireEvent.change(screen.getByLabelText("Neighborhood, landmark, or address"), { target:{ value:"Upper West Side" } });
    fireEvent.click(screen.getByRole("button", { name:"Set" }));
    await screen.findByText("Starting point set.");
    fireEvent.click(await screen.findByRole("button", { name:/Build a plan around this/ }));
    await screen.findByRole("heading", { name:"Here’s your way out the door." });
    expect(vi.mocked(generateItineraries).mock.calls[0][0]).toMatchObject({ centerpiece_id:"demo-trivia", locked_candidate_ids:["demo-trivia"] });
  });
});
