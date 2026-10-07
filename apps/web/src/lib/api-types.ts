// Names used by the web app for the FastAPI contract. Regenerate the source with `npm run types:generate`.
import type { components } from "./api-types.generated";

type Schemas = components["schemas"];

export type GenerateRequest = Schemas["GenerateRequest"];
export type Mood = GenerateRequest["mood"];
export type TransportMode = GenerateRequest["transport_mode"];
export type DiscoveryMode = NonNullable<GenerateRequest["discovery_mode"]>;
export type Coordinates = Schemas["CoordinatesSchema"];
export type PlaceDetails = Schemas["PlaceDetailsSchema"];
export type TodayReason = Schemas["TodayReasonSchema"];
export type TravelLeg = Schemas["TravelLegResponse"];
export type TimelineStep = Schemas["TimelineStepResponse"];
export type CandidateData = Schemas["CandidateResponse"];
export type ItineraryPlan = Schemas["ItineraryPlanResponse-Output"];
export type AdditionalOption = Schemas["AdditionalOptionResponse-Output"];
export type GenerationResponse = Schemas["GenerationResponse-Output"];
export type DiscoveryResponse = Schemas["DiscoveryResponse"];
export type TodayEventsResponse = Schemas["TodayEventsResponse"];
export type RemixRequest = Schemas["RemixRequest"];
export type RemixResponse = Schemas["RemixResponse"];
export type ApplyOptionRequest = Schemas["ApplyOptionRequest"];
export type SharedBrief = Schemas["SharedBrief"];
export type CreateShareRequest = Schemas["CreateShareRequest"];
export type CreateShareResponse = Schemas["CreateShareResponse"];
export type SharedItineraryResponse = Schemas["SharedItineraryResponse"];
export type GeocodeResponse = Schemas["GeocodeResponse"];
