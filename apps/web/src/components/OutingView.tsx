"use client";

import { useState } from "react";
import type { ItineraryPlan, TransportMode } from "@/lib/api-types";
import { nycTime } from "@/lib/nyc-time";
import { directionsUrl, fieldguideEvent, priceLabel } from "@/lib/fieldguide";

export function OutingView({ plan, completed, transport, busy, onComplete, onAlternative, onBack, feedback, onFeedback }: {
  plan: ItineraryPlan; completed: string[]; transport: TransportMode; busy: boolean;
  onComplete: (id: string) => void; onAlternative: (location?: string) => void; onBack: () => void;
  feedback: boolean; onFeedback: () => void;
}) {
  const [location, setLocation] = useState("");
  const current = plan.steps.find((step) => !completed.includes(step.candidate_id));
  const index = current ? plan.steps.indexOf(current) : plan.steps.length;
  const next = plan.steps[index + 1];
  const last = index > 0 ? plan.steps[index - 1] : null;
  const [went, setWent] = useState<boolean | null>(null);
  return (
    <section className="outing-view" aria-labelledby="outing-title">
      <div className="edition-heading"><p className="eyebrow">Out in the city · {completed.length}/{plan.steps.length} stops</p><button className="text-button" onClick={onBack}>See the whole plan</button></div>
      <h2 id="outing-title">{current ? "One good stop at a time." : "A little more New York, discovered."}</h2>
      {current ? <>
        <article className="outing-now"><span className="outing-label">NOW / {String(index + 1).padStart(2, "0")}</span><h3>{current.name}</h3><p>{current.details?.activity || current.details?.description}</p><p>{nycTime(current.start_at)}–{nycTime(current.end_at)} · {priceLabel(current)}</p>{current.details?.registration && <p>{current.details.registration}</p>}<div className="outing-actions"><a className="generate-button" href={directionsUrl(current, transport)} target="_blank" rel="noreferrer">Get directions ↗</a><button className="outline-button" disabled={busy} onClick={() => onComplete(current.candidate_id)}>Mark stop complete ✓</button></div></article>
        {next && <article className="outing-next"><span className="outing-label">NEXT</span><div><h3>{next.name}</h3><p>Leave around {nycTime(new Date(new Date(next.start_at).getTime() - next.travel_before.minutes * 60_000))} · {next.travel_before.minutes} min {transport} estimate</p></div></article>}
        <details className="outing-replan"><summary>Find another next stop</summary><p>Keep completed stops and rebuild the remaining time and budget. Starting from {last?.name ?? "your original starting point"}.</p><label>Different starting point<input aria-label="Outing starting point" placeholder="Neighborhood, landmark, or address" value={location} onChange={(event) => setLocation(event.target.value)} /></label><button className="outline-button" disabled={busy} onClick={() => onAlternative(location || undefined)}>{busy ? "Checking what still fits…" : "Find another stop"}</button></details>
        <p className="fine-print">Planned times are estimates. Check the listing and directions for current access and travel.</p>
      </> : <div className="outing-feedback"><p>Your outing is complete. Two optional questions help us improve the field guide.</p>{feedback ? <p role="status">Thanks for the feedback.</p> : went === null ? <><h3>Did you go on this outing?</h3><button className="outline-button" onClick={() => { fieldguideEvent("outing_went"); setWent(true); }}>Yes, I went</button><button className="text-button" onClick={() => { fieldguideEvent("outing_did_not_go"); onFeedback(); }}>Not this time</button></> : <><h3>Did you discover somewhere new?</h3><button className="outline-button" onClick={() => { fieldguideEvent("discovered_somewhere_new"); onFeedback(); }}>Yes, somewhere new</button><button className="text-button" onClick={() => { fieldguideEvent("outing_familiar"); onFeedback(); }}>Familiar favorites</button></>}</div>}
    </section>
  );
}
