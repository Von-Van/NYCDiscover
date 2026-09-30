"use client";

import { useEffect, useState } from "react";
import { getTodayEvents } from "@/lib/api";
import type { CandidateData, Coordinates, TodayEventsResponse } from "@/lib/api-types";
import { nycLongDate, nycTime } from "@/lib/nyc-time";
import { useNYCDate } from "@/lib/use-nyc-date";

function admission(event: CandidateData) {
  if (event.details?.price_status === "free" && event.cost_high === 0) return "Free admission";
  if (!event.details || event.details.price_status === "unknown") return "Price not listed";
  const price = event.cost_low === event.cost_high ? `$${event.cost_high}` : `$${event.cost_low}–${event.cost_high}`;
  return `${event.details.price_status === "verified" ? "" : "Est. "}${price}`;
}

export function TodayEvents({ coordinates }: { coordinates: Coordinates }) {
  const today = useNYCDate();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: TodayEventsResponse; error?: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { latitude, longitude } = coordinates;
  const key = `${latitude}:${longitude}:${today}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    if (!today) return;
    getTodayEvents({ latitude, longitude }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResult({ key, data }); })
      .catch((error) => { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "The calendar is unavailable right now." }); });
    return () => controller.abort();
  }, [latitude, longitude, today, key]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision((n) => n + 1); };
    const timer = setInterval(refresh, 5 * 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const current = result?.key === key ? result : null;
  const data = current?.data;
  const events = data?.events ?? [];
  return (
    <section className="today-events" aria-labelledby="today-events-title" aria-busy={!current}>
      <header className="today-events-heading">
        <div><p className="eyebrow">The city calendar</p><h3 id="today-events-title">Also happening today</h3></div>
        <span className="events-radius">Within 5 miles</span>
      </header>
      <p className="events-intro">Dated events around your starting point, beyond this plan’s time, budget, and mood. Known recurring events are left out; unconfirmed repeat schedules are labeled.</p>
      {!current ? <p role="status" className="events-status">Checking today’s NYC calendar…</p> : current.error ? <div className="events-status" role="status"><p>{current.error}</p><button className="text-button" onClick={() => setRevision((n) => n + 1)}>Try the calendar again</button></div> : data && <>
        <p className="events-source">{data.data_mode === "fixture" ? "Sample events · fixture data" : "NYC Event Calendar"} · {nycLongDate(`${data.date}T12:00:00-04:00`)}<br />Checked {nycTime(data.generated_at)} New York time · Distances are straight-line estimates.</p>
        {data.warnings.length > 0 && <details className="events-source-notes"><summary>Calendar coverage notes</summary>{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
        {events.length === 0 ? <p className="events-status">No dated events with a mapped location were found within five miles today. The city calendar may not cover every local event.</p> : <ol className="today-events-list">
          {(expanded ? events : events.slice(0, 6)).map(({ event, distance_miles, status }) => <li key={`${event.id}-${event.start_at}`}>
            <div className="event-time"><time dateTime={event.start_at!}>{nycTime(event.start_at!)}</time>{event.end_at && <span>to {nycTime(event.end_at)}</span>}<span className={`event-status event-status-${status}`}>{status === "ended" ? "Ended" : status === "started" ? "Already started" : "Later today"}</span></div>
            <div className="event-copy">
              <h4>{event.name}</h4>
              <p className="event-location">{event.details?.neighborhood || event.details?.borough || "New York City"} · {event.location_is_approximate ? "About " : ""}{distance_miles} mi{event.location_is_approximate ? " · approximate location" : ""}</p>
              <p>{event.details?.description || "See the organizer’s listing for event details."}</p>
              <p className="event-admission">{admission(event)}{event.details?.registration ? ` · ${event.details.registration}` : ""}</p>
              <p className="event-recurrence">{event.recurrence === "one_off" ? "One-off event confirmed by the listing" : "Repeat schedule not provided"}{status === "started" && event.schedule_kind !== "drop_in" ? " · Late entry is not confirmed" : ""}</p>
              {event.source_url && /^https?:\/\//i.test(event.source_url) && <a href={event.source_url} target="_blank" rel="noreferrer">Read the event listing ↗</a>}
            </div>
          </li>)}
        </ol>}
        {events.length > 6 && <button className="text-button events-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer events" : `Read all ${events.length} events`}</button>}
      </>}
    </section>
  );
}
