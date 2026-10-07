import type {
  ApplyOptionRequest,
  CreateShareRequest,
  CreateShareResponse,
  GenerateRequest,
  GenerationResponse,
  GeocodeResponse,
  SharedItineraryResponse,
  DiscoveryResponse,
  RemixRequest,
  RemixResponse,
  Coordinates,
  TodayEventsResponse,
} from "./api-types";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:8000");

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      payload?.detail ?? `Request failed with status ${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function withTimeout(ms: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  return parseResponse<T>(await fetch(`${API_URL}${path}`, { signal: withTimeout(timeoutMs) }));
}

async function postJson<T>(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(timeoutMs, signal),
  });
  return parseResponse<T>(response);
}

export function geocodeLocation(query: string) {
  return getJson<GeocodeResponse>(`/v1/geocode?q=${encodeURIComponent(query)}`, 8_000);
}

export function getSharedItinerary(id: string) {
  return getJson<SharedItineraryResponse>(`/v1/shares/${encodeURIComponent(id)}`, 12_000);
}

export function generateItineraries(request: GenerateRequest) {
  return postJson<GenerationResponse>("/v1/itineraries/generate", request, 20_000);
}

export function discoverToday(request: GenerateRequest, signal?: AbortSignal) {
  return postJson<DiscoveryResponse>("/v1/discovery/today", request, 20_000, signal);
}

export function remixItinerary(request: RemixRequest) {
  return postJson<RemixResponse>("/v1/itineraries/remix", request, 20_000);
}

export function getTodayEvents(coordinates: Coordinates, signal: AbortSignal) {
  return postJson<TodayEventsResponse>("/v1/events/today", { coordinates }, 30_000, signal);
}

export function createShare(request: CreateShareRequest) {
  return postJson<CreateShareResponse>("/v1/shares", request, 12_000);
}

export function applyItineraryOption(request: ApplyOptionRequest) {
  return postJson<GenerationResponse>("/v1/itineraries/apply-option", request, 20_000);
}
