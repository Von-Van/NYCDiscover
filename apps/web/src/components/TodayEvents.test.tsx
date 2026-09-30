import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTodayEvents } from "@/lib/api";
import type { TodayEventsResponse } from "@/lib/api-types";
import { TodayEvents } from "./TodayEvents";

vi.mock("@/lib/api", () => ({ getTodayEvents: vi.fn() }));
const origin = { latitude: 40.787, longitude: -73.9754 };
const response: TodayEventsResponse = {
  date: "2026-09-30", radius_miles: 5, warnings: [], generated_at: "2026-09-30T13:00:00-04:00", data_mode: "live",
  events: [{ distance_miles: 4.2, status: "upcoming", event: {
    id: "city-concert", name: "An evening concert", category: "music", mood_tags: [], coordinates: origin,
    duration_minutes: 60, cost_low: 0, cost_high: 25, indoor: null, source_name: "NYC Event Calendar",
    source_url: "https://www.nyc.gov/events/concert", confidence: 0.7,
    start_at: "2026-09-30T20:00:00-04:00", end_at: "2026-09-30T21:00:00-04:00", recurrence: "unknown",
    details: { description: "An outdoor performance listed by the organizer.", activity: "", neighborhood: "Chelsea", borough: "Manhattan", price_status: "unknown", source_urls: [], signature: false },
  } }],
};
afterEach(() => vi.resetAllMocks());

describe("Today's events beside the plan", () => {
  it("requests only the origin and labels recurrence, price, time and distance", async () => {
    vi.mocked(getTodayEvents).mockResolvedValue(response);
    render(<TodayEvents coordinates={origin} />);
    await screen.findByRole("heading", { name: "An evening concert" });
    expect(getTodayEvents).toHaveBeenCalledWith(origin, expect.any(AbortSignal));
    expect(screen.getByText("Repeat schedule not provided")).toBeVisible();
    expect(screen.getByText("Price not listed")).toBeVisible();
    expect(screen.getByText(/Chelsea · 4.2 mi/)).toBeVisible();
    expect(screen.getByText("8:00 PM")).toBeVisible();
    expect(screen.getByRole("link", { name: /Read the event listing/ })).toHaveAttribute("href", response.events[0].event.source_url);
  });
  it("distinguishes an unavailable calendar from an empty list and retries", async () => {
    vi.mocked(getTodayEvents).mockRejectedValueOnce(new Error("Calendar unavailable"));
    render(<TodayEvents coordinates={origin} />);
    await screen.findByText("Calendar unavailable");
    expect(screen.queryByText(/No dated events/)).not.toBeInTheDocument();
    vi.mocked(getTodayEvents).mockResolvedValue({ ...response, events: [] });
    fireEvent.click(screen.getByRole("button", { name: "Try the calendar again" }));
    await screen.findByText(/No dated events with a mapped location/);
  });
  it("does not replace new-origin results with a stale response", async () => {
    let finish!: (response: TodayEventsResponse) => void;
    vi.mocked(getTodayEvents).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<TodayEvents coordinates={origin} />);
    vi.mocked(getTodayEvents).mockResolvedValue({ ...response, events: [] });
    rerender(<TodayEvents coordinates={{ latitude: 40.671, longitude: -73.98 }} />);
    await screen.findByText(/No dated events with a mapped location/);
    finish(response);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "An evening concert" })).not.toBeInTheDocument());
  });
});
