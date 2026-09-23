"use client";

import { useRef, useState } from "react";
import { nycTime } from "@/lib/nyc-time";
import type { AdditionalOption, ItineraryPlan } from "@/lib/api-types";

function time(value: string) {
  return nycTime(value);
}

function duration(minutes: number) {
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60 ? `${minutes % 60}m` : ""}`.trim();
}

interface AdditionalOptionsProps {
  plan: ItineraryPlan;
  disabled: boolean;
  pendingOptionId: string | null;
  status: string;
  error: string;
  onSwap: (option: AdditionalOption) => Promise<boolean>;
}

export function AdditionalOptions({ plan, disabled, pendingOptionId, status, error, onSwap }: AdditionalOptionsProps) {
  const [open, setOpen] = useState(false);
  const heading = useRef<HTMLButtonElement>(null);
  const options = plan.additional_options ?? [];
  const contentId = `additional-options-${plan.id}`;

  async function swap(option: AdditionalOption) {
    if (await onSwap(option)) heading.current?.focus({ preventScroll: true });
  }

  return (
    <section className="additional-options" aria-label="Additional Options">
      <h3 className="options-heading">
        <button
          ref={heading}
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
        >
          <span>Additional Options <small>{options.length}</small></span>
          <span className="options-toggle" aria-hidden="true">{open ? "−" : "+"}</span>
        </button>
      </h3>
      <div className="options-feedback" aria-live="polite" aria-atomic="true">
        {status && <p role="status">{status}</p>}
      </div>
      {error && <p className="options-error" role="alert">{error}</p>}
      <div id={contentId} hidden={!open}>
        <p className="options-intro">A different stop, the same brief. Choose a swap and we’ll update the route.</p>
        <div className="options-scroll" aria-busy={pendingOptionId !== null}>
          {options.length === 0 ? (
            <p className="options-empty">No other stops fit these plans right now. Try changing the brief or regenerating.</p>
          ) : plan.steps.map((stop, index) => {
            const replacements = options.filter((option) => option.replaces_candidate_id === stop.candidate_id);
            if (!replacements.length) return null;
            return (
              <section className="options-group" key={stop.candidate_id} aria-labelledby={`${contentId}-${index}`}>
                <h4 id={`${contentId}-${index}`}><span>Stop {index + 1}</span> Replace {stop.name}</h4>
                <ul className="options-list">
                  {replacements.map((option) => (
                    <li key={option.id}>
                      <div className="option-copy">
                        <span className="category-tag">{option.step.category}</span>
                        <h5>{option.step.name}</h5>
                        <p>{time(option.step.start_at)}–{time(option.step.end_at)} · ${option.step.cost_low}–${option.step.cost_high}</p>
                        <p className="option-confidence">{Math.round(option.step.confidence * 100)}% confidence · {option.step.source_name}</p>
                        <details>
                          <summary>What to verify</summary>
                          {option.step.estimate_notes.map((note) => <p key={note}>{note}</p>)}
                          {option.step.source_url && <a href={option.step.source_url} target="_blank" rel="noreferrer">Open source ↗</a>}
                        </details>
                        <p className="option-total">Updated plan: {duration(option.total_minutes)} · ${option.total_cost_low}–${option.total_cost_high} · {Math.round(option.confidence * 100)}% confidence</p>
                      </div>
                      <button
                        className="option-swap"
                        type="button"
                        disabled={disabled}
                        aria-label={`Swap in ${option.step.name} for ${stop.name}`}
                        onClick={() => void swap(option)}
                      >
                        {pendingOptionId === option.id ? "Swapping…" : "Swap in"} <span aria-hidden="true">↗</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
