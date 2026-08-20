"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createShare, generateItineraries, geocodeLocation } from "@/lib/api";
import type { GenerateRequest, GenerationResponse } from "@/lib/api-types";
import { buildDemoResponse } from "@/lib/demo-data";
import { toGenerateRequest, validateForm, type DiscoveryForm } from "@/lib/form";
import { getPlanComparisonLabels } from "@/lib/plan-comparison";
import { BriefFields, initialDiscoveryForm } from "./BriefFields";
import { ItineraryMap } from "./ItineraryMap";

const fallbackCoordinates = { latitude: 40.787, longitude: -73.9754 };

function copyForm(form: DiscoveryForm): DiscoveryForm {
  return {
    ...form,
    coordinates: form.coordinates ? { ...form.coordinates } : null,
  };
}

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

type GenerationMode = "initial" | "update" | "regenerate";

export function DiscoveryApp() {
  const [draftForm, setDraftForm] = useState<DiscoveryForm>(() => copyForm(initialDiscoveryForm));
  const [committedForm, setCommittedForm] = useState<DiscoveryForm | null>(null);
  const [phase, setPhase] = useState<"form" | "loading" | "results">("form");
  const [response, setResponse] = useState<GenerationResponse | null>(null);
  const [committedRequest, setCommittedRequest] = useState<GenerateRequest | null>(null);
  const [activePlanId, setActivePlanId] = useState("plan-1");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [seed, setSeed] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [previewStepId, setPreviewStepId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareStatus, setShareStatus] = useState<"idle" | "creating" | "ready" | "copied" | "error">("idle");
  const [shareMessage, setShareMessage] = useState("");
  const timelineRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const activePlan = useMemo(
    () => response?.plans.find((plan) => plan.id === activePlanId) ?? response?.plans[0],
    [activePlanId, response],
  );
  const planLabels = useMemo(
    () => getPlanComparisonLabels(response?.plans ?? []),
    [response],
  );
  const displayForm = committedForm ?? draftForm;
  const activeStepId = previewStepId ?? selectedStepId;

  useEffect(() => {
    if (!inspectorOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDraftForm(copyForm(committedForm ?? initialDiscoveryForm));
      setErrors([]);
      setMessage("");
      setInspectorOpen(false);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [committedForm, inspectorOpen]);

  function update<K extends keyof DiscoveryForm>(key: K, value: DiscoveryForm[K]) {
    setDraftForm((current) => ({ ...current, [key]: value }));
    setErrors([]);
  }

  function openInspector() {
    setDraftForm(copyForm(committedForm ?? draftForm));
    setErrors([]);
    setMessage("");
    setInspectorOpen(true);
  }

  function closeInspector() {
    setDraftForm(copyForm(committedForm ?? initialDiscoveryForm));
    setErrors([]);
    setMessage("");
    setInspectorOpen(false);
  }

  function returnToForm() {
    setDraftForm(copyForm(committedForm ?? draftForm));
    setInspectorOpen(false);
    setErrors([]);
    setMessage("");
    setPhase("form");
  }

  async function locateMe() {
    setMessage("Checking your location…");
    if (!navigator.geolocation) {
      setMessage("Browser location is unavailable. Search for a neighborhood or address instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        if (
          latitude < 40.4774 ||
          latitude > 40.9176 ||
          longitude < -74.2591 ||
          longitude > -73.7002
        ) {
          setMessage("Your current location is outside NYC. Search for a city starting point instead.");
          return;
        }
        setDraftForm((current) => ({
          ...current,
          locationLabel: "Current location",
          coordinates: { latitude, longitude },
        }));
        setMessage("Starting from your current location.");
      },
      () => setMessage("Location permission was not granted. Search by neighborhood instead."),
      { timeout: 8_000 },
    );
  }

  async function resolveLocation() {
    if (draftForm.locationLabel.trim().length < 3) {
      setMessage("Enter at least three characters.");
      return;
    }
    setMessage("Finding that spot in NYC…");
    try {
      const result = await geocodeLocation(draftForm.locationLabel.trim());
      const first = result.results[0];
      if (!first) throw new Error("No NYC location matched that search.");
      setDraftForm((current) => ({
        ...current,
        locationLabel: first.label,
        coordinates: { latitude: first.latitude, longitude: first.longitude },
      }));
      setMessage("Starting point set.");
    } catch {
      setDraftForm((current) => ({ ...current, coordinates: fallbackCoordinates }));
      setMessage("Using the Upper West Side demo starting point while the API is offline.");
    }
  }

  async function runGeneration(form: DiscoveryForm, nextSeed: number, mode: GenerationMode) {
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (formErrors.length > 0) return false;

    const request = toGenerateRequest(form, nextSeed);
    if (mode === "initial") setPhase("loading");
    else setIsUpdating(true);
    setMessage("");

    try {
      let result: GenerationResponse;
      try {
        result = await generateItineraries(request);
      } catch (error) {
        if (process.env.NEXT_PUBLIC_DEMO_FALLBACK === "false") throw error;
        result = buildDemoResponse(request);
      }

      const committed = copyForm(form);
      setResponse(result);
      setCommittedRequest(request);
      setCommittedForm(committed);
      setDraftForm(copyForm(committed));
      setActivePlanId(result.plans[0]?.id ?? "");
      setSelectedStepId(null);
      setPreviewStepId(null);
      setShareUrl("");
      setShareStatus("idle");
      setShareMessage("");
      setInspectorOpen(false);
      setErrors([]);
      setPhase("results");
      return true;
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Itinerary generation failed."]);
      if (mode === "initial") setPhase("form");
      if (mode === "update") setInspectorOpen(true);
      return false;
    } finally {
      if (mode !== "initial") setIsUpdating(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await runGeneration(draftForm, seed, "initial");
  }

  async function updatePlans(event: FormEvent) {
    event.preventDefault();
    await runGeneration(draftForm, seed, "update");
  }

  async function regenerate() {
    if (!committedForm) return;
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    await runGeneration(committedForm, nextSeed, "regenerate");
  }

  function selectTimelineStep(stepId: string) {
    setSelectedStepId(stepId);
    setPreviewStepId(null);
  }

  function activatePlan(planId: string) {
    setActivePlanId(planId);
    setSelectedStepId(null);
    setPreviewStepId(null);
    setShareUrl("");
    setShareStatus("idle");
    setShareMessage("");
  }

  async function copyShareUrl(url: string) {
    if (!navigator.clipboard) {
      setShareStatus("ready");
      setShareMessage("The link is ready below.");
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareStatus("copied");
    setShareMessage("Link copied. It expires in seven days.");
  }

  async function sharePlan() {
    if (shareUrl) {
      try {
        await copyShareUrl(shareUrl);
      } catch {
        setShareStatus("ready");
        setShareMessage("The link is ready below.");
      }
      return;
    }
    if (!response?.snapshot_token || !committedRequest || !activePlanId) return;
    setShareStatus("creating");
    setShareMessage("Creating a private seven-day snapshot…");
    try {
      const shared = await createShare({
        brief: committedRequest,
        generation: response,
        snapshot_token: response.snapshot_token,
        selected_plan_id: activePlanId,
      });
      const url = new URL(shared.path, window.location.origin).toString();
      setShareUrl(url);
      await copyShareUrl(url);
    } catch (error) {
      setShareStatus("error");
      setShareMessage(error instanceof Error ? error.message : "Could not create the link.");
    }
  }

  function selectMapStep(stepId: string) {
    setSelectedStepId(stepId);
    setPreviewStepId(null);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    timelineRefs.current[stepId]?.scrollIntoView({ behavior, block: "center" });
  }

  return (
    <main className="site-shell">
      <header className="masthead">
        <button className="brand" onClick={returnToForm} aria-label="NYC Discover home">
          <span className="brand-box">NYC</span>
          <span>DISCOVER</span>
        </button>
        <div className="masthead-rule">
          <span>VOL. 01</span>
          <span>{new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(new Date())}</span>
          <span>PLANS, NOT LISTS</span>
        </div>
      </header>

      {phase === "form" && (
        <section className="planner-layout">
          <div className="hero-copy">
            <p className="eyebrow">A field guide for right now</p>
            <h1>
              New York,
              <br />
              <em>decided.</em>
            </h1>
            <p className="dek">
              Give us a few practical constraints. Get back a small plan that fits the hours you
              actually have.
            </p>
            <div className="hero-note">
              <span className="note-number">01</span>
              <p>
                Built for the gap after work, the free afternoon, and the group chat that has gone
                nowhere.
              </p>
            </div>
          </div>

          <form className="planner-card" onSubmit={submit} noValidate>
            <div className="card-heading">
              <span>THE BRIEF</span>
              <strong>Tell us what kind of day this is.</strong>
            </div>
            <BriefFields
              form={draftForm}
              message={message}
              errors={errors}
              onLocateMe={locateMe}
              onResolveLocation={resolveLocation}
              onUpdate={update}
            />
            <div className="planner-submit-bar">
              <button className="generate-button" type="submit">
                Make my plan <span aria-hidden="true">→</span>
              </button>
              <p className="fine-print">
                Same-day plans only. Prices and travel times are estimates; verify before leaving.
              </p>
            </div>
          </form>
        </section>
      )}

      {phase === "loading" && (
        <section className="loading-state" aria-live="polite">
          <div className="route-loader"><span /><span /><span /></div>
          <p className="eyebrow">Working the route</p>
          <h2>Finding the version of tonight that fits.</h2>
          <p>Checking distance, time, weather, cost, and whether the pieces make sense together.</p>
        </section>
      )}

      {phase === "results" && response && (
        <section className={inspectorOpen ? "results-section inspector-is-open" : "results-section"}>
          <div className="results-workspace">
            <div className="results-main">
              <div className="results-heading">
                <div>
                  <p className="eyebrow">Plans for {displayForm.locationLabel}</p>
                  <h1>Here’s your way out the door.</h1>
                </div>
                <div className="results-actions">
                  <button
                    className="text-button"
                    onClick={openInspector}
                    aria-expanded={inspectorOpen}
                    aria-controls="brief-inspector"
                  >
                    Change the brief
                  </button>
                  <button className="outline-button" onClick={regenerate} disabled={isUpdating}>
                    {isUpdating ? "Working…" : "Regenerate"}
                  </button>
                  {response.snapshot_token && (
                    <button
                      className="share-button"
                      onClick={sharePlan}
                      disabled={isUpdating || shareStatus === "creating"}
                    >
                      {shareStatus === "creating"
                        ? "Creating…"
                        : shareStatus === "copied"
                          ? "Link copied"
                          : shareUrl
                            ? "Copy link"
                            : "Share plan"}
                    </button>
                  )}
                </div>
              </div>

              <div className={`data-mode-notice ${response.data_mode}`} role="status">
                <strong>{response.data_mode === "live" ? "Live data beta" : "Fixture demonstration"}</strong>
                <span>
                  {response.data_mode === "live"
                    ? "Built from current public place, event, and weather sources. Verify details before leaving."
                    : "This environment uses a stable sample dataset; no live provider calls were made."}
                </span>
              </div>

              {shareMessage && (
                <div
                  className={shareStatus === "error" ? "share-message error" : "share-message"}
                  role={shareStatus === "error" ? "alert" : "status"}
                >
                  <span>{shareMessage}</span>
                  {shareUrl && <a href={shareUrl}>{shareUrl}</a>}
                </div>
              )}

              {isUpdating && <p className="generation-status" role="status">Updating plans without losing your place…</p>}
              {errors.length > 0 && !inspectorOpen && (
                <div className="error-box results-error" role="alert">
                  {errors.map((error) => <p key={error}>{error}</p>)}
                </div>
              )}

              <div className="conditions-rail">
                <div className="weather-strip">
                  <span className="weather-mark" aria-hidden="true">{response.weather.is_wet ? "☂" : "☼"}</span>
                  <div>
                    <strong>{response.weather.temperature_f ? `${response.weather.temperature_f}° · ` : ""}{response.weather.summary}</strong>
                    <span>{response.weather.precipitation_probability}% chance of precipitation</span>
                  </div>
                  <span className="weather-source">{response.weather.source_name}</span>
                </div>

                {response.warnings.length > 0 && (
                  <div className="warning-strip" role="status">
                    <strong>Heads up</strong>
                    <span>{response.warnings.join(" ")}</span>
                  </div>
                )}
              </div>

              {response.plans.length === 0 ? (
                <div className="empty-state">
                  <p className="eyebrow">No honest fit</p>
                  <h2>These constraints are too tight for the available data.</h2>
                  <p>Try adding time, budget, or travel radius. We would rather return no plan than a bad one.</p>
                  <button className="generate-button" onClick={openInspector}>Adjust the brief</button>
                </div>
              ) : activePlan ? (
                <>
                  <nav className="plan-tabs" aria-label="Choose an itinerary">
                    {response.plans.map((plan, index) => (
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
                        <small>
                          {durationLabel(plan.total_minutes)} · up to ${plan.total_cost_high} · {Math.round(plan.confidence * 100)}% confidence
                        </small>
                      </button>
                    ))}
                  </nav>

                  <div className="result-grid">
                    <article className="timeline-card">
                      <div className="plan-summary">
                        <div>
                          <p className="eyebrow">{activePlan.subtitle}</p>
                          <h2>{activePlan.title}</h2>
                        </div>
                        <div className="confidence-seal">
                          <strong>{Math.round(activePlan.confidence * 100)}</strong>
                          <span>{confidenceLabel(activePlan.confidence)}</span>
                        </div>
                      </div>
                      <dl className="plan-facts">
                        <div><dt>Total time</dt><dd>{durationLabel(activePlan.total_minutes)}</dd></div>
                        <div><dt>Est. spend</dt><dd>${activePlan.total_cost_low}–${activePlan.total_cost_high}</dd></div>
                        <div><dt>Stops</dt><dd>{activePlan.steps.length}</dd></div>
                        <div><dt>Travel</dt><dd>{displayForm.transportMode}</dd></div>
                      </dl>

                      <ol className="timeline">
                        {activePlan.steps.map((step, index) => (
                          <li
                            key={step.candidate_id}
                            ref={(node) => { timelineRefs.current[step.candidate_id] = node; }}
                            className={activeStepId === step.candidate_id ? "active" : ""}
                            data-stop-id={step.candidate_id}
                            onMouseEnter={() => setPreviewStepId(step.candidate_id)}
                            onMouseLeave={() => setPreviewStepId(null)}
                            onFocusCapture={() => setPreviewStepId(step.candidate_id)}
                            onBlurCapture={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                setPreviewStepId(null);
                              }
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
                              aria-pressed={selectedStepId === step.candidate_id}
                              onClick={() => selectTimelineStep(step.candidate_id)}
                            >
                              {index + 1}
                            </button>
                            <div className="stop-card">
                              <div className="stop-time">
                                <strong>{formatTime(step.start_at)}</strong>
                                <span>to {formatTime(step.end_at)}</span>
                              </div>
                              <div className="stop-copy">
                                <span className="category-tag">{step.category}</span>
                                <h3>
                                  <button type="button" onClick={() => selectTimelineStep(step.candidate_id)}>
                                    {step.name}
                                  </button>
                                </h3>
                                <p>${step.cost_low}–${step.cost_high} · {confidenceLabel(step.confidence)}</p>
                                <details>
                                  <summary>What to verify</summary>
                                  {step.estimate_notes.map((note) => <p key={note}>{note}</p>)}
                                  {step.source_url && <a href={step.source_url} target="_blank" rel="noreferrer">Open source ↗</a>}
                                </details>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                      <div className="estimate-note">
                        <strong>Before you go</strong>
                        <ul>{activePlan.estimate_notes.map((note) => <li key={note}>{note}</li>)}</ul>
                      </div>
                    </article>

                    <aside className="map-column">
                      <ItineraryMap
                        plan={activePlan}
                        activeStepId={activeStepId}
                        selectedStepId={selectedStepId}
                        onStepPreview={setPreviewStepId}
                        onStepSelect={selectMapStep}
                      />
                      <div className="map-caption">
                        <span>NOT TURN-BY-TURN</span>
                        <p>Connectors show the shape of the plan. Check your preferred navigation app before leaving.</p>
                      </div>
                    </aside>
                  </div>
                </>
              ) : null}
            </div>

            {inspectorOpen && (
              <aside id="brief-inspector" className="brief-inspector" aria-labelledby="brief-inspector-title">
                <form onSubmit={updatePlans} noValidate>
                  <div className="inspector-heading">
                    <div>
                      <p className="eyebrow">Edit the assignment</p>
                      <h2 id="brief-inspector-title">The brief</h2>
                    </div>
                    <button type="button" className="inspector-close" onClick={closeInspector} aria-label="Close brief editor">×</button>
                  </div>
                  <div className="inspector-scroll">
                    <BriefFields
                      form={draftForm}
                      message={message}
                      errors={errors}
                      disabled={isUpdating}
                      compact
                      onLocateMe={locateMe}
                      onResolveLocation={resolveLocation}
                      onUpdate={update}
                    />
                  </div>
                  <div className="inspector-actions">
                    <button type="button" className="text-button" onClick={closeInspector} disabled={isUpdating}>Cancel</button>
                    <button type="submit" className="generate-button" disabled={isUpdating}>
                      {isUpdating ? "Updating…" : "Update plans"} <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </form>
              </aside>
            )}
          </div>
        </section>
      )}

      <footer>
        <span>NYC DISCOVER</span>
        <p>Recommend plans, not options.</p>
        <span><a href="/privacy">PRIVACY</a> · <a href="https://github.com/Von-Van/NYCDiscover/issues">GITHUB ISSUES</a></span>
      </footer>
    </main>
  );
}
