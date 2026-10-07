"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { GenerationResponse, ItineraryPlan, TimelineStep } from "@/lib/api-types";
import { confidenceLabel, durationLabel, priceLabel } from "@/lib/fieldguide";
import { nycTime } from "@/lib/nyc-time";

// Hovering a stop previews it on the map; clicking selects it until another stop is chosen.
export function useStepFocus() {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [previewStepId, setPreviewStepId] = useState<string | null>(null);
  const stopRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const clear = useCallback(() => {
    setSelectedStepId(null);
    setPreviewStepId(null);
  }, []);

  const select = useCallback((stepId: string) => {
    setSelectedStepId(stepId);
    setPreviewStepId(null);
  }, []);

  const selectFromMap = useCallback((stepId: string) => {
    select(stepId);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    stopRefs.current[stepId]?.scrollIntoView({ behavior, block: "center" });
  }, [select]);

  const registerStop = useCallback((stepId: string) => (node: HTMLLIElement | null) => {
    stopRefs.current[stepId] = node;
  }, []);

  return {
    activeStepId: previewStepId ?? selectedStepId,
    selectedStepId,
    preview: setPreviewStepId,
    select,
    selectFromMap,
    clear,
    registerStop,
  };
}

export type StepFocus = ReturnType<typeof useStepFocus>;

export function WeatherStrip({ weather }: { weather: GenerationResponse["weather"] }) {
  return (
    <div className="weather-strip">
      <span className="weather-mark" aria-hidden="true">{weather.is_wet ? "☂" : "☼"}</span>
      <div>
        <strong>{weather.temperature_f ? `${weather.temperature_f}° · ` : ""}{weather.summary}</strong>
        <span>{weather.precipitation_probability}% chance of precipitation</span>
      </div>
      <span className="weather-source">{weather.source_name}</span>
    </div>
  );
}

interface PlanTabsProps {
  plans: ItineraryPlan[];
  activePlanId: string;
  labels: Map<string, string>;
  onSelect: (planId: string) => void;
  hidden?: boolean;
  disabledReason?: (plan: ItineraryPlan) => string | null;
}

export function PlanTabs({ plans, activePlanId, labels, onSelect, hidden, disabledReason }: PlanTabsProps) {
  return (
    <nav className="plan-tabs" aria-label="Choose an itinerary" hidden={hidden}>
      {plans.map((plan, index) => {
        const reason = disabledReason?.(plan) ?? null;
        return (
          <button
            key={plan.id}
            className={activePlanId === plan.id ? "active" : ""}
            aria-pressed={activePlanId === plan.id}
            onClick={() => onSelect(plan.id)}
            disabled={reason !== null}
            title={reason || undefined}
          >
            <span className="plan-tab-topline">
              <span>Plan {String.fromCharCode(65 + index)}</span>
              {labels.get(plan.id) && <mark>{labels.get(plan.id)}</mark>}
            </span>
            <strong>{plan.title}</strong>
            <small>{durationLabel(plan.total_minutes)} · up to ${plan.total_cost_high}</small>
          </button>
        );
      })}
    </nav>
  );
}

export function PlanFacts({ plan, transportMode }: { plan: ItineraryPlan; transportMode: string }) {
  return (
    <dl className="plan-facts">
      <div><dt>Total time</dt><dd>{durationLabel(plan.total_minutes)}</dd></div>
      <div><dt>Est. spend</dt><dd>${plan.total_cost_low}–${plan.total_cost_high}</dd></div>
      <div><dt>Stops</dt><dd>{plan.steps.length}</dd></div>
      <div><dt>Travel</dt><dd>{transportMode}</dd></div>
    </dl>
  );
}

interface TimelineStopProps {
  step: TimelineStep;
  index: number;
  focus: StepFocus;
  actions?: ReactNode;
}

export function TimelineStop({ step, index, focus, actions }: TimelineStopProps) {
  const id = step.candidate_id;
  return (
    <li
      ref={focus.registerStop(id)}
      className={focus.activeStepId === id ? "active" : ""}
      data-stop-id={id}
      onMouseEnter={() => focus.preview(id)}
      onMouseLeave={() => focus.preview(null)}
      onFocusCapture={() => focus.preview(id)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focus.preview(null);
      }}
    >
      <div className="travel-label">
        <span>{step.travel_before.minutes} min {step.travel_before.mode}</span>
        <small>{step.travel_before.distance_miles} mi estimate</small>
      </div>
      <button
        type="button"
        className="timeline-marker"
        aria-label={`Show stop ${index + 1}, ${step.name}, on the map`}
        aria-pressed={focus.selectedStepId === id}
        onClick={() => focus.select(id)}
      >
        {index + 1}
      </button>
      <div className="stop-card">
        <div className="stop-time">
          <strong>{nycTime(step.start_at)}</strong>
          <span>to {nycTime(step.end_at)}</span>
        </div>
        <div className="stop-copy">
          <span className="category-tag">{step.category}</span>
          <h3><button type="button" onClick={() => focus.select(id)}>{step.name}</button></h3>
          {step.details?.activity && <p className="stop-activity">{step.details.activity}</p>}
          <p className="stop-meta">{priceLabel(step)}{step.details?.neighborhood ? ` · ${step.details.neighborhood}` : ""}</p>
          {step.why_today && <p className="today-reason">{step.why_today.text}</p>}
          {step.details?.registration && <p className="registration-note">{step.details.registration}</p>}
          {actions}
          <details>
            <summary>What to verify</summary>
            <p>{confidenceLabel(step.confidence)}</p>
            {step.details?.reviewed_at && <p>Field notes reviewed {step.details.reviewed_at}.</p>}
            {step.estimate_notes.map((note) => <p key={note}>{note}</p>)}
            {step.source_url && <a href={step.source_url} target="_blank" rel="noreferrer">Open source ↗</a>}
          </details>
        </div>
      </div>
    </li>
  );
}
