"use client";

import { useEffect, useState } from "react";
import { discoverToday } from "@/lib/api";
import type { DiscoveryResponse } from "@/lib/api-types";
import { toGenerateRequest, type DiscoveryForm } from "@/lib/form";
import { getDiscoverySession, saveDiscoverySession } from "@/lib/discovery-session";
import { nycTime } from "@/lib/nyc-time";
import { fieldguideEvent, priceLabel } from "@/lib/fieldguide";

export function TodayEdition({ form, onChoose, disabled }: { form: DiscoveryForm; onChoose: (id: string) => void; disabled: boolean }) {
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  // Store the brief with the result so an old card cannot be selected during a refetch.
  const briefKey = JSON.stringify(form);
  const [resultKey, setResultKey] = useState("");
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision((n) => n + 1); };
    const interval = setInterval(refresh, 5 * 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    if (!form.coordinates) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      let request;
      try { request = toGenerateRequest(form, 0); }
      catch (error) { setError(error instanceof Error ? error.message : "Choose a valid time."); setLoading(false); return; }
      const session = getDiscoverySession();
      discoverToday({ ...request, discovery_mode: session.mode, seen_candidate_ids: session.seen, visited_candidate_ids: session.visited, excluded_candidate_ids: session.excluded }, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setResult(data);
          setResultKey(briefKey);
          saveDiscoverySession({ seen: [...getDiscoverySession().seen, ...(data.cards ?? []).map((c) => c.step.candidate_id)] });
        })
        .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Today's picks are unavailable."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [form, briefKey, revision]);

  return (
    <section className="today-edition" aria-labelledby="today-title" aria-busy={loading}>
      <div className="edition-heading"><div><p className="eyebrow">Your neighborhood dispatch</p><h2 id="today-title">A few reasons to go out.</h2></div>{form.coordinates && <button type="button" className="text-button" disabled={loading || disabled} onClick={() => setRevision((n) => n + 1)}>Refresh today’s picks ↻</button>}</div>
      {!form.coordinates ? <p className="edition-empty">Choose a starting point above. We’ll find what fits around you today.</p> : error ? <p className="edition-empty" role="status">{error} You can still try making a plan with the brief above.</p> : loading || resultKey !== briefKey ? <p className="edition-empty" role="status">Checking the neighborhood’s calendar…</p> : <>
        <p className="edition-source">{result?.data_mode === "fixture" ? "Sample edition · fixture data" : "Today’s public listings"}{result?.generated_at ? ` · Checked ${nycTime(result.generated_at)} New York time` : ""}</p>
        <div className="discovery-cards">
          {(result?.cards ?? []).map(({ label, step }, index) => (
            <article className="discovery-card" key={step.candidate_id}>
              <div className="discovery-kicker"><span>{label}</span><span>0{index + 1}</span></div>
              <p className="neighborhood-label">{step.details?.neighborhood || "Nearby"}{step.details?.borough ? ` / ${step.details.borough}` : ""}</p>
              <h3>{step.name}</h3>
              <p>{step.details?.description || step.details?.activity || "A nearby stop that fits your brief."}</p>
              {step.why_today && <p className="today-reason">{step.why_today.text}</p>}
              <p className="discovery-facts">{step.schedule_kind === "drop_in" ? "Drop-in visit · " : step.schedule_kind === "fixed_start" ? "Starts " : "Suggested visit · "}{nycTime(step.start_at)}–{nycTime(step.end_at)}<br />{priceLabel(step)}</p>
              {step.details?.registration && <p className="registration-note">{step.details.registration}</p>}
              <div className="discovery-card-bottom"><button type="button" disabled={disabled || resultKey !== briefKey} onClick={() => { fieldguideEvent("discovery_selected"); onChoose(step.candidate_id); }}>Build a plan around this <span aria-hidden="true">↗</span></button>{step.source_url && <a href={step.source_url} target="_blank" rel="noreferrer">Check the listing</a>}</div>
            </article>
          ))}
        </div>
        {result && !result.cards?.length && <p className="edition-empty">No picks fit this brief right now. Try another time, a wider radius, or a different starting point.</p>}
        {result?.warnings.map((warning) => <p className="edition-source" key={warning}>{warning}</p>)}
      </>}
    </section>
  );
}
