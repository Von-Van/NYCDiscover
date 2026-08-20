"use client";

import maplibregl, { type Map as MapLibreMap, type Marker, type Popup } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { ItineraryPlan } from "@/lib/api-types";

interface ItineraryMapProps {
  plan: ItineraryPlan;
  activeStepId?: string | null;
  selectedStepId?: string | null;
  onStepPreview?: (stepId: string | null) => void;
  onStepSelect?: (stepId: string) => void;
}

interface MarkerEntry {
  element: HTMLButtonElement;
  marker: Marker;
  popup: Popup;
}

function coLocatedMarkerOffsets(plan: ItineraryPlan): [number, number][] {
  const keys = plan.steps.map(
    (step) =>
      `${step.coordinates.latitude.toFixed(5)}:${step.coordinates.longitude.toFixed(5)}`,
  );
  const totals = new Map<string, number>();
  const positions = new Map<string, number>();
  for (const key of keys) totals.set(key, (totals.get(key) ?? 0) + 1);

  return keys.map((key) => {
    const total = totals.get(key) ?? 1;
    if (total === 1) return [0, 0];
    const position = positions.get(key) ?? 0;
    positions.set(key, position + 1);
    const angle = (position / total) * Math.PI * 2 - Math.PI / 2;
    return [Math.round(Math.cos(angle) * 22), Math.round(Math.sin(angle) * 22)];
  });
}

export function ItineraryMap({
  plan,
  activeStepId = null,
  selectedStepId = null,
  onStepPreview,
  onStepSelect,
}: ItineraryMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const activeStepRef = useRef(activeStepId);
  const selectedStepRef = useRef(selectedStepId);
  const previewCallbackRef = useRef(onStepPreview);
  const selectCallbackRef = useRef(onStepSelect);

  useEffect(() => {
    previewCallbackRef.current = onStepPreview;
  }, [onStepPreview]);

  useEffect(() => {
    selectCallbackRef.current = onStepSelect;
  }, [onStepSelect]);

  useEffect(() => {
    activeStepRef.current = activeStepId;
    selectedStepRef.current = selectedStepId;
  }, [activeStepId, selectedStepId]);

  useEffect(() => {
    for (const [stepId, entry] of markersRef.current) {
      entry.element.classList.toggle("active", stepId === activeStepId);
      entry.element.classList.toggle("selected", stepId === selectedStepId);
      entry.element.setAttribute("aria-pressed", String(stepId === selectedStepId));
    }
  }, [activeStepId, selectedStepId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const entry of markersRef.current.values()) entry.popup.remove();
    if (!selectedStepId) return;

    const entry = markersRef.current.get(selectedStepId);
    const step = plan.steps.find((candidate) => candidate.candidate_id === selectedStepId);
    if (!entry || !step) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({
      center: [step.coordinates.longitude, step.coordinates.latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: reducedMotion ? 0 : 450,
    });
    entry.popup
      .setLngLat([step.coordinates.longitude, step.coordinates.latitude])
      .addTo(map);
  }, [plan, selectedStepId]);

  useEffect(() => {
    if (!containerRef.current || plan.steps.length === 0) return;
    const markers = new Map<string, MarkerEntry>();
    markersRef.current = markers;
    const first = plan.steps[0].coordinates;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [first.longitude, first.latitude],
      zoom: 13,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              process.env.NEXT_PUBLIC_OSM_TILE_URL ??
                "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      const coordinates = plan.steps.map((step) => [
        step.coordinates.longitude,
        step.coordinates.latitude,
      ]);
      const markerOffsets = coLocatedMarkerOffsets(plan);

      if (coordinates.length > 1) {
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          },
        });
        map.addLayer({
          id: "route-shadow",
          type: "line",
          source: "route",
          paint: { "line-color": "#f5efe0", "line-width": 9, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#d62f26",
            "line-width": 4,
            "line-dasharray": [1, 1.2],
          },
        });
      }

      const bounds = new maplibregl.LngLatBounds();
      plan.steps.forEach((step, index) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "map-pin";
        element.textContent = String(index + 1);
        element.setAttribute("aria-label", `Stop ${index + 1}: ${step.name}`);
        element.setAttribute("aria-pressed", "false");
        element.addEventListener("mouseenter", () => previewCallbackRef.current?.(step.candidate_id));
        element.addEventListener("mouseleave", () => previewCallbackRef.current?.(null));
        element.addEventListener("focus", () => previewCallbackRef.current?.(step.candidate_id));
        element.addEventListener("blur", () => previewCallbackRef.current?.(null));
        element.addEventListener("click", () => selectCallbackRef.current?.(step.candidate_id));

        const marker = new maplibregl.Marker({ element, offset: markerOffsets[index] })
          .setLngLat([step.coordinates.longitude, step.coordinates.latitude])
          .addTo(map);
        const popup = new maplibregl.Popup({ offset: 18, closeOnClick: false }).setText(step.name);
        markers.set(step.candidate_id, { element, marker, popup });
        bounds.extend([step.coordinates.longitude, step.coordinates.latitude]);
      });

      for (const [stepId, entry] of markers) {
        entry.element.classList.toggle("active", stepId === activeStepRef.current);
        entry.element.classList.toggle("selected", stepId === selectedStepRef.current);
        entry.element.setAttribute("aria-pressed", String(stepId === selectedStepRef.current));
      }
      if (plan.steps.length > 1) map.fitBounds(bounds, { padding: 65, maxZoom: 14 });

      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && coordinates.length > 1) {
        const patterns = [
          [1, 1.2],
          [0.8, 1.4],
          [0.6, 1.6],
          [0.8, 1.4],
        ];
        let frame = 0;
        const timer = window.setInterval(() => {
          if (map.getLayer("route")) {
            map.setPaintProperty("route", "line-dasharray", patterns[frame % patterns.length]);
            frame += 1;
          }
        }, 450);
        map.once("remove", () => window.clearInterval(timer));
      }
    });

    return () => {
      for (const entry of markers.values()) {
        entry.popup.remove();
        entry.marker.remove();
      }
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [plan]);

  return (
    <div className="map-shell" aria-label={`Map for ${plan.title}`}>
      <div ref={containerRef} className="map-canvas" />
      <div className="map-stamp" aria-hidden="true">
        PLAN
        <strong>{plan.id.replace("plan-", "")}</strong>
      </div>
    </div>
  );
}
