"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, applyItineraryOption, createShare, generateItineraries, geocodeLocation, remixItinerary } from "@/lib/api";
import type { AdditionalOption, GenerateRequest, GenerationResponse } from "@/lib/api-types";
import { applyDemoOption, buildDemoResponse } from "@/lib/demo-data";
import { toGenerateRequest, validateForm, type DiscoveryForm } from "@/lib/form";
import { getPlanComparisonLabels } from "@/lib/plan-comparison";
import { BriefFields, initialDiscoveryForm } from "./BriefFields";
import { ItineraryMap } from "./ItineraryMap";
import { AdditionalOptions } from "./AdditionalOptions";
import { useNYCDate } from "@/lib/use-nyc-date";
import { TodayEdition } from "./TodayEdition";
import { OutingView } from "./OutingView";
import { getDiscoverySession, useDiscoverySession, saveDiscoverySession, resetDiscoverySession } from "@/lib/discovery-session";
import { fieldguideEvent, priceLabel } from "@/lib/fieldguide";
import { nycTime, nycLongDate, nycDate } from "@/lib/nyc-time";

const fallbackCoordinates = { latitude: 40.787, longitude: -73.9754 };

function copyForm(form: DiscoveryForm): DiscoveryForm {
  return {
    ...form,
    coordinates: form.coordinates ? { ...form.coordinates } : null,
    moods: [...form.moods],
  };
}

function formatTime(value: string) {
  return nycTime(value);
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
  const session = useDiscoverySession();
  const editionDate = useNYCDate();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editionVersion, setEditionVersion] = useState(0);
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
  const [localDemo, setLocalDemo] = useState(false);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [swapStatus, setSwapStatus] = useState("");
  const [swapError, setSwapError] = useState("");
  const mutationPending = useRef(false);
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
  const busy = isUpdating || pendingOptionId !== null || shareStatus === "creating";

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
    if (mutationPending.current) return;
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
    if (mutationPending.current) return;
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
    } catch (error) {
      if (process.env.NEXT_PUBLIC_DEMO_FALLBACK === "false" || error instanceof ApiError) {
        setMessage(error instanceof Error ? error.message : "Could not find that starting point.");
      } else {
        setDraftForm((current) => ({ ...current, coordinates: fallbackCoordinates }));
        setMessage("Using the Upper West Side demo starting point while the API is offline.");
      }
    }
  }

  async function runGeneration(form: DiscoveryForm, nextSeed: number, mode: GenerationMode, centerpieceId: string | null = null) {
    if (mutationPending.current) return false;
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (formErrors.length > 0) return false;

    let request: GenerateRequest;
    try {
      const memory = getDiscoverySession();
      request = { ...toGenerateRequest(form, nextSeed), centerpiece_id: centerpieceId, discovery_mode: memory.mode,
        seen_candidate_ids: memory.seen, visited_candidate_ids: memory.visited, excluded_candidate_ids: memory.excluded,
        locked_candidate_ids: centerpieceId ? [centerpieceId] : mode === "initial" ? [] : memory.locked };
    } catch (error) { setErrors([error instanceof Error ? error.message : "Choose a valid time."]); return false; }
    mutationPending.current = true;
    if (mode === "initial") setPhase("loading");
    else setIsUpdating(true);
    setMessage("");

    try {
      let result: GenerationResponse;
      let usingLocalDemo = false;
      try {
        result = await generateItineraries(request);
      } catch (error) {
        if (process.env.NEXT_PUBLIC_DEMO_FALLBACK === "false" || error instanceof ApiError || centerpieceId || request.locked_candidate_ids?.length) throw error;
        result = buildDemoResponse(request);
        usingLocalDemo = true;
      }

      const committed = copyForm(form);
      setResponse(result);
      setLocalDemo(usingLocalDemo);
      setSwapStatus("");
      setSwapError("");
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
      saveDiscoverySession({ saved: { brief: request, generation: result, form: committed, planId: result.plans[0]?.id ?? "" },
        seen: [...getDiscoverySession().seen, ...result.plans.flatMap((p) => p.steps.map((s) => s.candidate_id))],
        locked: request.locked_candidate_ids ?? [], completed: [], outing: false, promptDismissed: false, feedback: false });
      fieldguideEvent("generation_succeeded");
      return true;
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Itinerary generation failed."]);
      if (mode === "initial") setPhase("form");
      if (mode === "update") setInspectorOpen(true);
      return false;
    } finally {
      mutationPending.current = false;
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
    if (response?.swap_token) { await remixPlan(); return; }
    if (!committedForm) return;
    if (session.locked.length) { setErrors(["Connect to the planner to keep stops while remixing."]); return; }
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    await runGeneration(committedForm, nextSeed, "regenerate");
  }

  function resumeSaved() {
    const saved = session.saved;
    if (!saved || nycDate(saved.brief.start_at) !== nycDate()) return;
    setResponse(saved.generation); setCommittedRequest(saved.brief); setCommittedForm(saved.form);
    setDraftForm(copyForm(saved.form)); setActivePlanId(saved.planId); setLocalDemo(!saved.generation.swap_token);
    setPhase("results");
  }

  async function remixPlan(excludeId?: string, continueOuting = false, location?: string) {
    if (mutationPending.current || !response?.swap_token || !committedRequest || !activePlan || !committedForm) return;
    const memory = getDiscoverySession();
    continueOuting = continueOuting || memory.completed.length > 0;
    const excluded = [...new Set([...memory.excluded, ...(excludeId ? [excludeId] : [])])];
    if (excluded.length > 200) { setErrors(["This session has 200 dismissed places. Reset this session to explore again."]); return; }
    saveDiscoverySession({ excluded });
    mutationPending.current = true; setIsUpdating(true); setErrors([]);
    try {
      let currentCoordinates;
      if (location) {
        const found = await geocodeLocation(location);
        if (!found.results[0]) throw new Error("No NYC starting point matched. Try a more specific address.");
        currentCoordinates = { latitude: found.results[0].latitude, longitude: found.results[0].longitude };
      }
      const updated = await remixItinerary({ brief: committedRequest, generation: response, swap_token: response.swap_token,
        plan_id: activePlan.id, locked_candidate_ids: memory.locked, excluded_candidate_ids: excluded,
        seen_candidate_ids: memory.seen, visited_candidate_ids: memory.visited, discovery_mode: memory.mode,
        completed_candidate_ids: continueOuting ? memory.completed : [], continue_outing: continueOuting,
        current_coordinates: currentCoordinates, current_location_label: location });
      setResponse(updated.generation); setCommittedRequest(updated.brief); setActivePlanId(updated.generation.plans[0]?.id ?? "");
      setSelectedStepId(null); setPreviewStepId(null); setShareUrl(""); setShareStatus("idle"); setShareMessage("");
      const form = { ...committedForm, coordinates: updated.brief.coordinates, locationLabel: updated.brief.location_label,
        availableMinutes: updated.brief.available_minutes, budgetMax: updated.brief.budget_max };
      setCommittedForm(form); setDraftForm(copyForm(form));
      saveDiscoverySession({ saved: { brief: updated.brief, generation: updated.generation, form, planId: updated.generation.plans[0]?.id ?? "" },
        excluded, seen: [...memory.seen, ...updated.generation.plans.flatMap((p) => p.steps.map((s) => s.candidate_id))] });
      setSwapStatus("Your plan is refreshed. Kept stops stay in place.");
    } catch (error) { setErrors([error instanceof Error ? error.message : "Could not remix this outing."]); }
    finally { mutationPending.current = false; setIsUpdating(false); }
  }

  function resetSession() {
    resetDiscoverySession(); setEditionVersion((n) => n + 1); setSwapStatus("Session reset. Your visible plan is still available.");
  }

  function selectTimelineStep(stepId: string) {
    setSelectedStepId(stepId);
    setPreviewStepId(null);
  }

  function activatePlan(planId: string) {
    if (mutationPending.current) return;
    const nextPlan = response?.plans.find((plan) => plan.id === planId);
    if (!nextPlan || session.locked.some((id) => !nextPlan.steps.some((step) => step.candidate_id === id))) return;
    setActivePlanId(planId);
    saveDiscoverySession({ locked: session.locked, completed: [], outing: false, promptDismissed: false, feedback: false,
      saved: session.saved ? { ...session.saved, planId } : null });
    setSelectedStepId(null);
    setPreviewStepId(null);
    setShareUrl("");
    setShareStatus("idle");
    setShareMessage("");
    setSwapStatus("");
    setSwapError("");
  }

  async function swapOption(option: AdditionalOption) {
    if (mutationPending.current || inspectorOpen || !response || !committedRequest || !activePlan) return false;
    if (!localDemo && !response.swap_token) return false;
    if (session.locked.includes(option.replaces_candidate_id)) { setSwapError("Unlock this stop before replacing it."); return false; }
    mutationPending.current = true;
    setPendingOptionId(option.id);
    setSwapError("");
    setSwapStatus("Updating your route…");
    const previous = activePlan.steps.find((step) => step.candidate_id === option.replaces_candidate_id);
    try {
      const updated = localDemo
        ? applyDemoOption(committedRequest, response, activePlan.id, option.id)
        : await applyItineraryOption({
          brief: committedRequest,
          generation: response,
          swap_token: response.swap_token!,
          plan_id: activePlan.id,
          option_id: option.id,
        });
      setResponse(updated);
      saveDiscoverySession({ saved: { brief: committedRequest, generation: updated, form: committedForm!, planId: activePlan.id } });
      setSelectedStepId(null);
      setPreviewStepId(null);
      setShareUrl("");
      setShareStatus("idle");
      setShareMessage("");
      setSwapStatus(`${option.step.name} replaced ${previous?.name ?? "your stop"}. Route and estimates updated.`);
      return true;
    } catch (error) {
      setSwapStatus("");
      setSwapError(error instanceof Error ? error.message : "Could not swap this stop. Please try again.");
      return false;
    } finally {
      setPendingOptionId(null);
      mutationPending.current = false;
    }
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
    if (mutationPending.current) return;
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
    mutationPending.current = true;
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
    } finally {
      mutationPending.current = false;
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
        <button className="brand" onClick={returnToForm} disabled={busy || phase === "loading"} aria-label="NYC Discover home">
          <span className="brand-box">NYC</span>
          <span>DISCOVER</span>
        </button>
        <div className="masthead-rule">
          <span>VOL. 01</span>
          <span suppressHydrationWarning>{editionDate ? nycLongDate(`${editionDate}T12:00:00-04:00`) : "Today in New York"}</span>
          <span>PLANS, NOT LISTS</span>
        </div>
      </header>

      {phase === "form" && (
        <section className="daily-front-page">{session.saved && nycDate(session.saved.brief.start_at) === nycDate() && <div className="resume-strip"><span>You have a plan from this session.</span><button className="text-button" onClick={resumeSaved}>Resume your outing →</button></div>}<div className="planner-layout edition-planner">
          <div className="hero-copy">
            <p className="eyebrow">A field guide for right now</p>
            <h1>
              Your day,
              <br />
              <em>around here.</em>
            </h1>
            <p className="dek">
              A market morning. A small museum. A turn you haven’t taken.
              Find your own little piece of New York today.
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
              <span>START SOMEWHERE</span>
              <strong>The city is closer than you think.</strong>
            </div>
            <div className="borough-starts" aria-label="Starting points in all five boroughs">
              {([
                ["Manhattan", "Upper West Side", 40.787, -73.9754], ["Brooklyn", "Park Slope", 40.671, -73.9814],
                ["Queens", "Astoria", 40.7644, -73.9235], ["The Bronx", "Fordham", 40.861, -73.89],
                ["Staten Island", "St. George", 40.6437, -74.0765],
              ] as const).map(([borough, name, latitude, longitude]) => <button key={borough} type="button" title={`Start in ${name}`} onClick={() => { setDraftForm((f) => ({ ...f, locationLabel: name, coordinates: { latitude, longitude } })); setMessage(`Starting in ${name}.`); }}>{borough}</button>)}
            </div>
            <BriefFields
              progressive={!advancedOpen}
              form={draftForm}
              message={message}
              errors={errors}
              onLocateMe={locateMe}
              onResolveLocation={resolveLocation}
              onUpdate={update}
            />
            <div className="brief-summary"><span>{draftForm.groupSize} people · {draftForm.transportMode} · {draftForm.radiusMiles} mi · {draftForm.moods.join(" + ")}</span><button type="button" className="text-button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>{advancedOpen ? "Fewer details −" : "More details +"}</button></div>
            <div className="planner-submit-bar">
              <button className="generate-button" type="submit">
                Make my plan <span aria-hidden="true">→</span>
              </button>
              <p className="fine-print">
                Same-day plans only. Prices and travel times are estimates; verify before leaving.
              </p>
            </div>
          </form>
          </div>
          <div className="discovery-controls"><div className="discovery-modes" aria-label="Discovery style">{([["easy", "Easy favorites"], ["new", "Something new"], ["surprise", "Surprise me"]] as const).map(([mode, label]) => <button type="button" key={mode} aria-pressed={session.mode === mode} onClick={() => { saveDiscoverySession({ mode }); setEditionVersion((n) => n + 1); }}>{label}</button>)}</div><button className="text-button" onClick={resetSession}>Reset this session</button></div>
          <TodayEdition key={editionVersion} form={draftForm} disabled={busy} onChoose={(id) => void runGeneration(draftForm, seed, "initial", id)} />
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
        <section className={`results-section${inspectorOpen ? " inspector-is-open" : ""}${session.outing ? " outing-is-active" : ""}`}>
          <div className="results-workspace">
            <div className="results-main">
              <div className="results-heading">
                <div>
                  <p className="eyebrow">Plans for {displayForm.locationLabel}</p>
                  <h1>{session.outing ? "Out in New York." : "Here’s your way out the door."}</h1>
                </div>
                <div className="results-actions">
                  <button
                    className="text-button"
                    onClick={openInspector}
                    disabled={busy || session.completed.length > 0}
                    aria-expanded={inspectorOpen}
                    aria-controls="brief-inspector"
                  >
                    Change the brief
                  </button>
                  <button className="outline-button" onClick={regenerate} disabled={busy || session.outing}>
                    {isUpdating ? "Working…" : "Regenerate"}
                  </button>
                  {shareUrl && typeof navigator !== "undefined" && !!navigator.share && <button className="text-button" onClick={() => void navigator.share({ title: activePlan?.title ?? "NYC Discover", url: shareUrl }).catch(() => setShareMessage("Your link is ready to copy below."))}>Share to…</button>}
                  {response.snapshot_token && (
                    <button
                      className="share-button"
                      onClick={sharePlan}
                      disabled={busy}
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

              <div className="plan-steering" hidden={session.outing}>
              <div className="discovery-controls"><div className="discovery-modes" aria-label="Discovery style">{([["easy", "Easy favorites"], ["new", "Something new"], ["surprise", "Surprise me"]] as const).map(([mode, label]) => <button type="button" key={mode} disabled={busy} aria-pressed={session.mode === mode} onClick={() => saveDiscoverySession({ mode })}>{label}</button>)}</div><button className="text-button" disabled={busy} onClick={resetSession}>Reset this session</button></div>
              {activePlan && <div className="outing-entry"><button className="generate-button" disabled={busy} onClick={() => { saveDiscoverySession({ outing: !session.outing }); if (!session.outing) fieldguideEvent("outing_started"); }}>{session.outing ? "Back to the full plan" : "Start this outing →"}</button><span>Keep the next good stop close at hand.</span></div>}
              </div>
              {session.outing && activePlan && <OutingView plan={activePlan} completed={session.completed} transport={displayForm.transportMode} busy={busy}
                onComplete={(id) => saveDiscoverySession({ completed: [...session.completed, id], visited: [...session.visited, id] })}
                onAlternative={(location) => void remixPlan(activePlan.steps.find((s) => !session.completed.includes(s.candidate_id))?.candidate_id, true, location)}
                onBack={() => saveDiscoverySession({ outing: false })} feedback={session.feedback} onFeedback={() => saveDiscoverySession({ feedback: true })} />}
              <div className="conditions-rail" hidden={session.outing}>
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
                  <nav className="plan-tabs" aria-label="Choose an itinerary" hidden={session.outing}>
                    {response.plans.map((plan, index) => (
                      <button
                        key={plan.id}
                        className={activePlan.id === plan.id ? "active" : ""}
                        aria-pressed={activePlan.id === plan.id}
                        onClick={() => activatePlan(plan.id)}
                        disabled={busy || session.completed.length > 0 || session.locked.some((id) => !plan.steps.some((step) => step.candidate_id === id))}
                        title={session.locked.some((id) => !plan.steps.some((step) => step.candidate_id === id)) ? "Unlock kept stops to choose this alternative" : undefined}
                      >
                        <span className="plan-tab-topline">
                          <span>Plan {String.fromCharCode(65 + index)}</span>
                          {planLabels.get(plan.id) && <mark>{planLabels.get(plan.id)}</mark>}
                        </span>
                        <strong>{plan.title}</strong>
                        <small>
                          {durationLabel(plan.total_minutes)} · up to ${plan.total_cost_high}
                        </small>
                      </button>
                    ))}
                  </nav>

                  <div className="result-grid" hidden={session.outing}>
                    <article className="timeline-card">
                      <div className="plan-summary">
                        <div>
                          <p className="eyebrow">{activePlan.subtitle}</p>
                          <h2>{activePlan.title}</h2>
                        </div>
                        <span className="edition-stamp">{activePlan.character || "Your daily edition"}</span>
                      </div>
                      {activePlan.introduction && <p className="plan-introduction">{activePlan.introduction}</p>}
                      {activePlan.why_today && <p className="today-reason">Why today · {activePlan.why_today.text}</p>}
                      {activePlan.prompt && !session.promptDismissed && <aside className="small-prompt"><span>A little invitation</span><p>{activePlan.prompt}</p><button className="text-button" onClick={() => saveDiscoverySession({ promptDismissed: true })}>Skip this prompt</button></aside>}
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
                                {step.details?.activity && <p className="stop-activity">{step.details.activity}</p>}
                                <p>{priceLabel(step)}{step.details?.neighborhood ? ` · ${step.details.neighborhood}` : ""}</p>
                                {step.why_today && <p className="today-reason">{step.why_today.text}</p>}
                                {step.details?.registration && <p className="registration-note">{step.details.registration}</p>}
                                <div className="stop-actions"><button type="button" disabled={busy || !response.swap_token} aria-pressed={session.locked.includes(step.candidate_id)} onClick={() => saveDiscoverySession({ locked: session.locked.includes(step.candidate_id) ? session.locked.filter((id) => id !== step.candidate_id) : [...session.locked, step.candidate_id] })}>{session.locked.includes(step.candidate_id) ? "Kept · unlock" : "Keep this stop"}</button><button type="button" aria-pressed={session.visited.includes(step.candidate_id)} onClick={() => saveDiscoverySession({ visited: [...session.visited, step.candidate_id] })}>{session.visited.includes(step.candidate_id) ? "Visited ✓" : "I’ve been here"}</button><button type="button" disabled={busy || !response.swap_token || session.completed.includes(step.candidate_id) || session.locked.includes(step.candidate_id)} onClick={() => void remixPlan(step.candidate_id)}>Show another idea</button></div>
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
                        ))}
                      </ol>
                      {(localDemo || response.swap_token) && (
                        <AdditionalOptions
                          key={activePlan.id}
                          plan={{ ...activePlan, additional_options: activePlan.additional_options?.filter((option) => !session.locked.includes(option.replaces_candidate_id)) }}
                          disabled={busy || inspectorOpen || session.completed.length > 0}
                          pendingOptionId={pendingOptionId}
                          status={swapStatus}
                          error={swapError}
                          onSwap={swapOption}
                        />
                      )}
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
