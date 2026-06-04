"use client";

import { FormEvent, useMemo, useState } from "react";
import { generateItineraries, geocodeLocation } from "@/lib/api";
import type {
  GenerationResponse,
  ItineraryPlan,
  Mood,
  TransportMode,
} from "@/lib/api-types";
import { buildDemoResponse } from "@/lib/demo-data";
import { toGenerateRequest, validateForm, type DiscoveryForm } from "@/lib/form";
import { ItineraryMap } from "./ItineraryMap";

const moods: Array<{ value: Mood; label: string; mark: string }> = [
  { value: "social", label: "Social", mark: "S" },
  { value: "relaxing", label: "Relaxing", mark: "R" },
  { value: "outdoors", label: "Outdoors", mark: "O" },
  { value: "date-night", label: "Date night", mark: "D" },
  { value: "productive", label: "Productive", mark: "P" },
  { value: "chaotic", label: "Chaotic", mark: "!" },
  { value: "low-energy", label: "Low energy", mark: "L" },
  { value: "cultural", label: "Cultural", mark: "C" },
  { value: "food-focused", label: "Food-focused", mark: "F" },
];

const durations = [
  [90, "1½ hours"],
  [120, "2 hours"],
  [180, "3 hours"],
  [240, "4 hours"],
  [360, "6 hours"],
] as const;

const fallbackCoordinates = { latitude: 40.787, longitude: -73.9754 };
const initialForm: DiscoveryForm = {
  locationLabel: "",
  coordinates: null,
  startMode: "now",
  laterTime: "19:00",
  availableMinutes: 240,
  budgetMax: 40,
  groupSize: 2,
  transportMode: "walk",
  radiusMiles: 2,
  mood: "social",
};

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

export function DiscoveryApp() {
  const [form, setForm] = useState<DiscoveryForm>(initialForm);
  const [phase, setPhase] = useState<"form" | "loading" | "results">("form");
  const [response, setResponse] = useState<GenerationResponse | null>(null);
  const [activePlanId, setActivePlanId] = useState("plan-1");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [seed, setSeed] = useState(0);
  const activePlan = useMemo(
    () => response?.plans.find((plan) => plan.id === activePlanId) ?? response?.plans[0],
    [activePlanId, response],
  );

  function update<K extends keyof DiscoveryForm>(key: K, value: DiscoveryForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
        setForm((current) => ({
          ...current,
          locationLabel: "Current location",
          coordinates: {
            latitude,
            longitude,
          },
        }));
        setMessage("Starting from your current location.");
      },
      () => setMessage("Location permission was not granted. Search by neighborhood instead."),
      { timeout: 8_000 },
    );
  }

  async function resolveLocation() {
    if (form.locationLabel.trim().length < 3) {
      setMessage("Enter at least three characters.");
      return;
    }
    setMessage("Finding that spot in NYC…");
    try {
      const result = await geocodeLocation(form.locationLabel.trim());
      const first = result.results[0];
      if (!first) throw new Error("No NYC location matched that search.");
      setForm((current) => ({
        ...current,
        locationLabel: first.label,
        coordinates: { latitude: first.latitude, longitude: first.longitude },
      }));
      setMessage("Starting point set.");
    } catch {
      setForm((current) => ({ ...current, coordinates: fallbackCoordinates }));
      setMessage("Using the Upper West Side demo starting point while the API is offline.");
    }
  }

  async function runGeneration(nextSeed = seed) {
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (formErrors.length > 0) return;
    const request = toGenerateRequest(form, nextSeed);
    setPhase("loading");
    setMessage("");
    try {
      const result = await generateItineraries(request);
      setResponse(result);
      setActivePlanId(result.plans[0]?.id ?? "");
    } catch (error) {
      if (process.env.NEXT_PUBLIC_DEMO_FALLBACK === "false") {
        setErrors([error instanceof Error ? error.message : "Itinerary generation failed."]);
        setPhase("form");
        return;
      }
      const result = buildDemoResponse(request);
      setResponse(result);
      setActivePlanId(result.plans[0]?.id ?? "");
    }
    setPhase("results");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await runGeneration(seed);
  }

  async function regenerate() {
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    await runGeneration(nextSeed);
  }

  return (
    <main className="site-shell">
      <header className="masthead">
        <button className="brand" onClick={() => setPhase("form")} aria-label="NYC Discover home">
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

            <fieldset className="form-section location-section">
              <legend>
                <span>1</span> Start here
              </legend>
              <label htmlFor="location">Neighborhood, landmark, or address</label>
              <div className="location-row">
                <input
                  id="location"
                  value={form.locationLabel}
                  onChange={(event) => {
                    update("locationLabel", event.target.value);
                    update("coordinates", null);
                  }}
                  placeholder="Try “Upper West Side”"
                  autoComplete="street-address"
                />
                <button type="button" className="square-button" onClick={resolveLocation}>
                  Set
                </button>
              </div>
              <button type="button" className="text-button" onClick={locateMe}>
                <span className="crosshair" aria-hidden="true">⌖</span> Use my current location
              </button>
              {message && <p className="form-message" role="status">{message}</p>}
            </fieldset>

            <div className="form-grid">
              <fieldset className="form-section">
                <legend>
                  <span>2</span> Start time
                </legend>
                <div className="segmented">
                  {(["now", "later"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={form.startMode === mode ? "active" : ""}
                      onClick={() => update("startMode", mode)}
                    >
                      {mode === "now" ? "Now" : "Later today"}
                    </button>
                  ))}
                </div>
                {form.startMode === "later" && (
                  <input
                    aria-label="Start time"
                    type="time"
                    value={form.laterTime}
                    onChange={(event) => update("laterTime", event.target.value)}
                  />
                )}
              </fieldset>

              <fieldset className="form-section">
                <legend>
                  <span>3</span> Time available
                </legend>
                <select
                  aria-label="Time available"
                  value={form.availableMinutes}
                  onChange={(event) => update("availableMinutes", Number(event.target.value))}
                >
                  {durations.map(([value, label]) => (
                    <option value={value} key={value}>{label}</option>
                  ))}
                </select>
              </fieldset>
            </div>

            <div className="form-grid">
              <fieldset className="form-section">
                <legend>
                  <span>4</span> Per-person budget
                </legend>
                <div className="range-readout">
                  <span>$0</span>
                  <strong>${form.budgetMax}</strong>
                </div>
                <input
                  aria-label="Maximum per-person budget"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={form.budgetMax}
                  onChange={(event) => update("budgetMax", Number(event.target.value))}
                />
              </fieldset>

              <fieldset className="form-section">
                <legend>
                  <span>5</span> Group size
                </legend>
                <div className="stepper">
                  <button
                    type="button"
                    aria-label="Decrease group size"
                    onClick={() => update("groupSize", Math.max(1, form.groupSize - 1))}
                  >−</button>
                  <strong>{form.groupSize}</strong>
                  <button
                    type="button"
                    aria-label="Increase group size"
                    onClick={() => update("groupSize", Math.min(12, form.groupSize + 1))}
                  >+</button>
                </div>
              </fieldset>
            </div>

            <fieldset className="form-section">
              <legend>
                <span>6</span> How are you moving?
              </legend>
              <div className="transport-row">
                {(["walk", "bike", "transit"] as TransportMode[]).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    className={form.transportMode === mode ? "active" : ""}
                    onClick={() => update("transportMode", mode)}
                  >
                    <i aria-hidden="true">{mode === "walk" ? "↟" : mode === "bike" ? "◎" : "M"}</i>
                    {mode}
                  </button>
                ))}
                <label className="radius-control">
                  <span>Radius</span>
                  <select
                    value={form.radiusMiles}
                    onChange={(event) => update("radiusMiles", Number(event.target.value))}
                  >
                    <option value="1">1 mi</option>
                    <option value="2">2 mi</option>
                    <option value="3">3 mi</option>
                    <option value="5">5 mi</option>
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset className="form-section mood-section">
              <legend>
                <span>7</span> Pick the mood
              </legend>
              <div className="mood-grid">
                {moods.map((mood) => (
                  <button
                    type="button"
                    key={mood.value}
                    className={form.mood === mood.value ? "active" : ""}
                    aria-pressed={form.mood === mood.value}
                    onClick={() => update("mood", mood.value)}
                  >
                    <span aria-hidden="true">{mood.mark}</span>
                    {mood.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {errors.length > 0 && (
              <div className="error-box" role="alert">
                {errors.map((error) => <p key={error}>{error}</p>)}
              </div>
            )}

            <button className="generate-button" type="submit">
              Make my plan <span aria-hidden="true">→</span>
            </button>
            <p className="fine-print">
              Same-day plans only. Prices and travel times are estimates; verify before leaving.
            </p>
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
        <section className="results-section">
          <div className="results-heading">
            <div>
              <p className="eyebrow">Plans for {form.locationLabel}</p>
              <h1>Here’s your way out the door.</h1>
            </div>
            <div className="results-actions">
              <button className="text-button" onClick={() => setPhase("form")}>Change the brief</button>
              <button className="outline-button" onClick={regenerate}>Regenerate</button>
            </div>
          </div>

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

          {response.plans.length === 0 ? (
            <div className="empty-state">
              <p className="eyebrow">No honest fit</p>
              <h2>These constraints are too tight for the available data.</h2>
              <p>Try adding time, budget, or travel radius. We would rather return no plan than a bad one.</p>
              <button className="generate-button" onClick={() => setPhase("form")}>Adjust the brief</button>
            </div>
          ) : activePlan ? (
            <>
              <nav className="plan-tabs" aria-label="Choose an itinerary">
                {response.plans.map((plan, index) => (
                  <button
                    key={plan.id}
                    className={activePlan.id === plan.id ? "active" : ""}
                    onClick={() => setActivePlanId(plan.id)}
                  >
                    <span>Plan {String.fromCharCode(65 + index)}</span>
                    <strong>{plan.title}</strong>
                    <small>{durationLabel(plan.total_minutes)} · up to ${plan.total_cost_high}</small>
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
                    <div><dt>Travel</dt><dd>{form.transportMode}</dd></div>
                  </dl>

                  <ol className="timeline">
                    {activePlan.steps.map((step, index) => (
                      <li key={step.candidate_id}>
                        <div className="travel-label">
                          <span>{step.travel_before.minutes} min {step.travel_before.mode}</span>
                          <small>{step.travel_before.distance_miles} mi estimate</small>
                        </div>
                        <div className="timeline-marker">{index + 1}</div>
                        <div className="stop-card">
                          <div className="stop-time">
                            <strong>{formatTime(step.start_at)}</strong>
                            <span>to {formatTime(step.end_at)}</span>
                          </div>
                          <div className="stop-copy">
                            <span className="category-tag">{step.category}</span>
                            <h3>{step.name}</h3>
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
                  <ItineraryMap plan={activePlan} />
                  <div className="map-caption">
                    <span>NOT TURN-BY-TURN</span>
                    <p>Connectors show the shape of the plan. Check your preferred navigation app before leaving.</p>
                  </div>
                </aside>
              </div>
            </>
          ) : null}
        </section>
      )}

      <footer>
        <span>NYC DISCOVER</span>
        <p>Recommend plans, not options.</p>
        <span>OPEN DATA · HONEST ESTIMATES</span>
      </footer>
    </main>
  );
}
