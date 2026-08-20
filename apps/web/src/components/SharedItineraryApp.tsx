"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getSharedItinerary } from "@/lib/api";
import type { SharedItineraryResponse } from "@/lib/api-types";
import { getPlanComparisonLabels } from "@/lib/plan-comparison";
import { ItineraryMap } from "./ItineraryMap";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours ? `${hours}h ` : ""}${remainder ? `${remainder}m` : ""}`.trim();
}

function confidenceLabel(confidence: number) {
  if (confidence >= 0.82) return "High confidence";
  if (confidence >= 0.66) return "Good confidence";
  return "Worth verifying";
}

interface SharedItineraryAppProps {
  shareId: string;
}

export function SharedItineraryApp({ shareId }: SharedItineraryAppProps) {
  const [shared, setShared] = useState<SharedItineraryResponse | null>(null);
  const [activePlanId, setActivePlanId] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [previewStepId, setPreviewStepId] = useState<string | null>(null);
  const [error, setError] = useState<"missing" | "expired" | "failed" | null>(null);
  const timelineRefs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    let active = true;
    getSharedItinerary(shareId)
      .then((result) => {
        if (!active) return;
        setShared(result);
        setActivePlanId(result.selected_plan_id);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        if (requestError instanceof ApiError && requestError.status === 410) setError("expired");
        else if (requestError instanceof ApiError && requestError.status === 404) setError("missing");
        else setError("failed");
      });
    return () => {
      active = false;
    };
  }, [shareId]);

  const activePlan = useMemo(
    () => shared?.generation.plans.find((plan) => plan.id === activePlanId) ?? shared?.generation.plans[0],
    [activePlanId, shared],
  );
  const planLabels = useMemo(
    () => getPlanComparisonLabels(shared?.generation.plans ?? []),
    [shared],
  );
  const activeStepId = previewStepId ?? selectedStepId;

  function activatePlan(planId: string) {
    setActivePlanId(planId);
    setSelectedStepId(null);
    setPreviewStepId(null);
  }

  function selectTimelineStep(stepId: string) {
    setSelectedStepId(stepId);
    setPreviewStepId(null);
  }

  function selectMapStep(stepId: string) {
    setSelectedStepId(stepId);
    setPreviewStepId(null);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    timelineRefs.current[stepId]?.scrollIntoView({ behavior, block: "center" });
  }

  if (error) {
    const message = error === "expired"
      ? "This seven-day itinerary has expired."
      : error === "missing"
        ? "That shared itinerary does not exist."
        : "The shared itinerary is temporarily unavailable.";
    return (
      <main className="site-shell shared-shell">
        <SharedMasthead />
        <section className="share-error" role="alert">
          <p className="eyebrow">Shared dispatch</p>
          <h1>{message}</h1>
          <p>The original starting point was never stored with the shared plan.</p>
          <Link className="generate-button" href="/">Make your own plan <span aria-hidden="true">→</span></Link>
        </section>
        <SharedFooter />
      </main>
    );
  }

  if (!shared || !activePlan) {
    return (
      <main className="site-shell shared-shell">
        <SharedMasthead />
        <section className="loading-state" aria-live="polite">
          <div className="route-loader"><span /><span /><span /></div>
          <p className="eyebrow">Opening the dispatch</p>
          <h1>Unfolding the plan.</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="site-shell shared-shell">
      <SharedMasthead />
      <section className="results-section shared-results">
        <div className="results-main">
          <div className="results-heading">
            <div>
              <p className="eyebrow">Shared NYC dispatch</p>
              <h1>A plan worth passing along.</h1>
            </div>
            <Link className="generate-button compact-cta" href="/">
              Make your own plan <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className={`data-mode-notice ${shared.generation.data_mode}`} role="status">
            <strong>{shared.generation.data_mode === "live" ? "Live data beta" : "Fixture demonstration"}</strong>
            <span>
              Shared plans are snapshots, not live reservations. This copy expires {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(shared.expires_at))}.
            </span>
          </div>

          <dl className="shared-brief-facts" aria-label="Shared brief">
            <div><dt>Time</dt><dd>{durationLabel(shared.brief.available_minutes)}</dd></div>
            <div><dt>Budget</dt><dd>up to ${shared.brief.budget_max}</dd></div>
            <div><dt>Group</dt><dd>{shared.brief.group_size}</dd></div>
            <div>
              <dt>Mood</dt>
              <dd>{(shared.brief.moods.length ? shared.brief.moods : [shared.brief.mood]).map((mood) => mood.replace("-", " ")).join(", ")}</dd>
            </div>
          </dl>

          <div className="conditions-rail">
            <div className="weather-strip">
              <span className="weather-mark" aria-hidden="true">{shared.generation.weather.is_wet ? "☂" : "☼"}</span>
              <div>
                <strong>{shared.generation.weather.temperature_f ? `${shared.generation.weather.temperature_f}° · ` : ""}{shared.generation.weather.summary}</strong>
                <span>{shared.generation.weather.precipitation_probability}% chance of precipitation</span>
              </div>
              <span className="weather-source">{shared.generation.weather.source_name}</span>
            </div>
          </div>

          <nav className="plan-tabs" aria-label="Choose an itinerary">
            {shared.generation.plans.map((plan, index) => (
              <button
                key={plan.id}
                className={activePlan.id === plan.id ? "active" : ""}
                aria-pressed={activePlan.id === plan.id}
                onClick={() => activatePlan(plan.id)}
              >
                <span className="plan-tab-topline">
                  <span>Plan {String.fromCharCode(65 + index)}</span>
                  {planLabels.get(plan.id) && <mark>{planLabels.get(plan.id)}</mark>}
                </span>
                <strong>{plan.title}</strong>
                <small>{durationLabel(plan.total_minutes)} · up to ${plan.total_cost_high} · {Math.round(plan.confidence * 100)}% confidence</small>
              </button>
            ))}
          </nav>

          <div className="result-grid">
            <article className="timeline-card">
              <div className="plan-summary">
                <div><p className="eyebrow">{activePlan.subtitle}</p><h2>{activePlan.title}</h2></div>
                <div className="confidence-seal"><strong>{Math.round(activePlan.confidence * 100)}</strong><span>{confidenceLabel(activePlan.confidence)}</span></div>
              </div>
              <dl className="plan-facts">
                <div><dt>Total time</dt><dd>{durationLabel(activePlan.total_minutes)}</dd></div>
                <div><dt>Est. spend</dt><dd>${activePlan.total_cost_low}–${activePlan.total_cost_high}</dd></div>
                <div><dt>Stops</dt><dd>{activePlan.steps.length}</dd></div>
                <div><dt>Travel</dt><dd>{shared.brief.transport_mode}</dd></div>
              </dl>
              <ol className="timeline">
                {activePlan.steps.map((step, index) => (
                  <li
                    key={step.candidate_id}
                    ref={(node) => { timelineRefs.current[step.candidate_id] = node; }}
                    className={activeStepId === step.candidate_id ? "active" : ""}
                    onMouseEnter={() => setPreviewStepId(step.candidate_id)}
                    onMouseLeave={() => setPreviewStepId(null)}
                    onFocusCapture={() => setPreviewStepId(step.candidate_id)}
                    onBlurCapture={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreviewStepId(null);
                    }}
                  >
                    <div className="travel-label"><span>{step.travel_before.minutes} min {step.travel_before.mode}</span><small>{step.travel_before.distance_miles} mi estimate</small></div>
                    <button
                      type="button"
                      className="timeline-marker"
                      aria-label={`Show stop ${index + 1}, ${step.name}, on the map`}
                      aria-pressed={selectedStepId === step.candidate_id}
                      onClick={() => selectTimelineStep(step.candidate_id)}
                    >{index + 1}</button>
                    <div className="stop-card">
                      <div className="stop-time"><strong>{formatTime(step.start_at)}</strong><span>to {formatTime(step.end_at)}</span></div>
                      <div className="stop-copy">
                        <span className="category-tag">{step.category}</span>
                        <h3><button type="button" onClick={() => selectTimelineStep(step.candidate_id)}>{step.name}</button></h3>
                        <p>${step.cost_low}–${step.cost_high} · {confidenceLabel(step.confidence)}</p>
                        <details><summary>What to verify</summary>{step.estimate_notes.map((note) => <p key={note}>{note}</p>)}{step.source_url && <a href={step.source_url} target="_blank" rel="noreferrer">Open source ↗</a>}</details>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
            <aside className="map-column">
              <ItineraryMap
                plan={activePlan}
                activeStepId={activeStepId}
                selectedStepId={selectedStepId}
                onStepPreview={setPreviewStepId}
                onStepSelect={selectMapStep}
              />
              <div className="map-caption"><span>ORIGIN REDACTED</span><p>The starting address is omitted from every shared snapshot.</p></div>
            </aside>
          </div>
        </div>
      </section>
      <SharedFooter />
    </main>
  );
}

function SharedMasthead() {
  return (
    <header className="masthead">
      <Link className="brand" href="/" aria-label="NYC Discover home"><span className="brand-box">NYC</span><span>DISCOVER</span></Link>
      <div className="masthead-rule"><span>SHARED EDITION</span><span>PLANS, NOT LISTS</span></div>
    </header>
  );
}

function SharedFooter() {
  return (
    <footer><span>NYC DISCOVER</span><p>Recommend plans, not options.</p><Link href="/privacy">PRIVACY</Link></footer>
  );
}
