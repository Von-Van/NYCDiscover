import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { laterTodayInNYC, nycDate, nycTime } from "./nyc-time";
import { directionsUrl, priceLabel } from "./fieldguide";
import { getDiscoverySession, resetDiscoverySession, saveDiscoverySession, useDiscoverySession } from "./discovery-session";
import type { TimelineStep } from "./api-types";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("New York time regardless of the visitor’s timezone", () => {
  it("uses the New York date around UTC midnight", () => {
    expect(nycDate("2026-09-27T03:59:00Z")).toBe("2026-09-26");
    expect(nycDate("2026-09-27T04:00:00Z")).toBe("2026-09-27");
    expect(nycTime("2026-09-27T03:59:00Z")).toBe("11:59 PM");
  });
  it("rejects a missing spring hour and chooses the reachable fall hour", () => {
    expect(() => laterTodayInNYC("02:30", new Date("2026-03-08T05:00:00Z"))).toThrow(/does not exist/);
    expect(laterTodayInNYC("01:30", new Date("2026-11-01T05:45:00Z")).toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(laterTodayInNYC("18:00", new Date("2026-09-26T12:00:00Z")).toISOString()).toBe("2026-09-26T22:00:00.000Z");
  });
});

it("never labels an unknown or estimated zero price as free", () => {
  const stop = { cost_low: 0, cost_high: 0 } as TimelineStep;
  expect(priceLabel(stop)).not.toBe("Free");
  expect(priceLabel({ ...stop, details: { price_status: "unknown" } as TimelineStep["details"] })).toMatch(/unconfirmed/i);
  expect(priceLabel({ ...stop, details: { price_status: "free" } as TimelineStep["details"] })).toBe("Free to visit");
});

it("makes keyless Maps links without publishing an origin", () => {
  const url = new URL(directionsUrl({ coordinates: { latitude: 40.787, longitude: -73.9754 } } as TimelineStep, "bike"));
  expect(url.origin).toBe("https://www.google.com");
  expect(url.searchParams.get("api")).toBe("1");
  expect(url.searchParams.get("travelmode")).toBe("bicycling");
  expect(url.searchParams.has("origin")).toBe(false);
  expect(url.searchParams.has("key")).toBe(false);
});

it("keeps session memory working when browser storage throws and resets it", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  saveDiscoverySession({ mode: "surprise", seen: ["a", "a"], visited: ["b"], excluded: ["c"] });
  expect(getDiscoverySession()).toMatchObject({ mode: "surprise", seen: ["a"], visited: ["b"], excluded: ["c"] });
  resetDiscoverySession();
  expect(getDiscoverySession()).toMatchObject({ mode: "new", seen: [], visited: [], excluded: [], completed: [], saved: null });
});


it("starts a fresh session at New York midnight even when the tab stays open", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T03:59:30Z"));
  resetDiscoverySession();
  const { result, unmount } = renderHook(() => useDiscoverySession());
  act(() => saveDiscoverySession({ seen: ["yesterday"], mode: "surprise" }));
  expect(result.current.seen).toEqual(["yesterday"]);
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current.seen).toEqual([]);
  expect(result.current.mode).toBe("new");
  unmount();
});
