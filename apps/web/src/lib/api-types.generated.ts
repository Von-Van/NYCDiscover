/**
 * Generated-contract snapshot for the FastAPI OpenAPI schema.
 * Run `npm run types:generate` while the API is running to refresh it.
 */
export interface paths {
  "/healthz": {
    get: operations["health_healthz_get"];
  };
  "/v1/geocode": {
    get: operations["geocode_v1_geocode_get"];
  };
  "/v1/itineraries/generate": {
    post: operations["generate_v1_itineraries_generate_post"];
  };
}

export interface operations {
  health_healthz_get: { responses: { 200: { content: { "application/json": components["schemas"]["HealthResponse"] } } } };
  geocode_v1_geocode_get: { responses: { 200: { content: { "application/json": components["schemas"]["GeocodeResponse"] } } } };
  generate_v1_itineraries_generate_post: { responses: { 200: { content: { "application/json": components["schemas"]["GenerationResponse"] } } } };
}

export interface components {
  schemas: {
    HealthResponse: { status: string; database: string; fixture_mode: boolean };
    GeocodeResponse: { results: Array<{ label: string; latitude: number; longitude: number }>; warnings: string[] };
    GenerationResponse: import("./api-types").GenerationResponse;
  };
}

