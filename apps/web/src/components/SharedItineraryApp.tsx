"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, getSharedItinerary } from "@/lib/api";
import type { SharedItineraryResponse } from "@/lib/api-types";
import { durationLabel } from "@/lib/fieldguide";
import { nycDate, nycLongDate } from "@/lib/nyc-time";
import { getPlanComparisonLabels } from "@/lib/plan-comparison";
import { useNYCDate } from "@/lib/use-nyc-date";
import { ItineraryMap } from "./ItineraryMap";
import { PlanFacts, PlanTabs, TimelineStop, WeatherStrip, useStepFocus } from "./PlanTimeline";

interface SharedItineraryAppProps {
  shareId: string;
}

export function SharedItineraryApp({ shareId }: SharedItineraryAppProps) {
  const today = useNYCDate();
  const [shared, setShared] = useState<SharedItineraryResponse | null>(null);
  const [activePlanId, setActivePlanId] = useState("");
  const focus = useStepFocus();
  const [error, setError] = useState<"missing" | "expired" | "failed" | null>(null);

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

  function activatePlan(planId: string) {
    setActivePlanId(planId);
    focus.clear();
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
              <dd>{(shared.brief.moods?.length ? shared.brief.moods : [shared.brief.mood]).map((mood) => mood.replace("-", " ")).join(", ")}</dd>
            </div>
          </dl>

          <div className="conditions-rail">
            <WeatherStrip weather={shared.generation.weather} />
          </div>

          <article className="shared-edition-card" aria-label="Shared daily edition">
            <p className="eyebrow">{nycLongDate(shared.brief.start_at)} · New York edition</p>
            <h2>{activePlan.title}</h2><p>{activePlan.introduction || activePlan.subtitle}</p>
            {activePlan.why_today && <p className="today-reason">Why that day · {activePlan.why_today.text}</p>}
            <p>{activePlan.steps.map((s) => s.name).join(" → ")}</p>
            {today && nycDate(shared.brief.start_at) !== today && <p role="status">This is a snapshot of a past outing. Times and availability have not been refreshed.</p>}
            <Link className="text-button" href="/">Make a plan for today →</Link>
          </article>
          <PlanTabs plans={shared.generation.plans} activePlanId={activePlan.id} labels={planLabels} onSelect={activatePlan} />

          <div className="result-grid">
            <article className="timeline-card">
              <div className="plan-summary">
                <div><p className="eyebrow">{activePlan.subtitle}</p><h2>{activePlan.title}</h2></div>
                <span className="edition-stamp">{activePlan.character || "Shared edition"}</span>
              </div>
              <PlanFacts plan={activePlan} transportMode={shared.brief.transport_mode} />
              <ol className="timeline">
                {activePlan.steps.map((step, index) => <TimelineStop key={step.candidate_id} step={step} index={index} focus={focus} />)}
              </ol>
            </article>
            <aside className="map-column">
              <ItineraryMap
                plan={activePlan}
                activeStepId={focus.activeStepId}
                selectedStepId={focus.selectedStepId}
                onStepPreview={focus.preview}
                onStepSelect={focus.selectFromMap}
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
      <div className="masthead-rule"><span>SHARED EDITION</span><span>Local Plans and Ideas, for Today</span></div>
    </header>
  );
}

function SharedFooter() {
  return (
    <footer><span>NYC DISCOVER</span><p>Make a better plan, today.</p><Link href="/privacy">PRIVACY</Link></footer>
  );
}
