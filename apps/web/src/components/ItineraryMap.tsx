"use client";

import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { ItineraryPlan } from "@/lib/api-types";

interface ItineraryMapProps {
  plan: ItineraryPlan;
}

export function ItineraryMap({ plan }: ItineraryMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || plan.steps.length === 0) return;
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
      const bounds = new maplibregl.LngLatBounds();
      plan.steps.forEach((step, index) => {
        const element = document.createElement("div");
        element.className = "map-pin";
        element.textContent = String(index + 1);
        new maplibregl.Marker({ element })
          .setLngLat([step.coordinates.longitude, step.coordinates.latitude])
          .setPopup(new maplibregl.Popup({ offset: 18 }).setText(step.name))
          .addTo(map);
        bounds.extend([step.coordinates.longitude, step.coordinates.latitude]);
      });
      if (plan.steps.length > 1) map.fitBounds(bounds, { padding: 65, maxZoom: 14 });

      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
      const source = map.getSource("route") as GeoJSONSource | undefined;
      if (source) source.setData({ type: "FeatureCollection", features: [] });
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

