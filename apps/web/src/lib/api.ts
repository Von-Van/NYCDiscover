import type {
  CreateShareRequest,
  CreateShareResponse,
  GenerateRequest,
  GenerationResponse,
  GeocodeResponse,
  SharedItineraryResponse,
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

export async function geocodeLocation(query: string): Promise<GeocodeResponse> {
  const response = await fetch(`${API_URL}/v1/geocode?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(8_000),
  });
  return parseResponse<GeocodeResponse>(response);
}

export async function generateItineraries(request: GenerateRequest): Promise<GenerationResponse> {
  const response = await fetch(`${API_URL}/v1/itineraries/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(20_000),
  });
  return parseResponse<GenerationResponse>(response);
}

export async function createShare(request: CreateShareRequest): Promise<CreateShareResponse> {
  const response = await fetch(`${API_URL}/v1/shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(12_000),
  });
  return parseResponse<CreateShareResponse>(response);
}

export async function getSharedItinerary(id: string): Promise<SharedItineraryResponse> {
  const response = await fetch(`${API_URL}/v1/shares/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(12_000),
  });
  return parseResponse<SharedItineraryResponse>(response);
}
