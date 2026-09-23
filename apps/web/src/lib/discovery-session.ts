"use client";

import { useSyncExternalStore } from "react";
import type { DiscoveryMode, GenerateRequest, GenerationResponse } from "./api-types";
import type { DiscoveryForm } from "./form";
import { nycDate } from "./nyc-time";

export interface DiscoverySession {
  mode: DiscoveryMode;
  seen: string[];
  visited: string[];
  excluded: string[];
  locked: string[];
  completed: string[];
  outing: boolean;
  promptDismissed: boolean;
  feedback: boolean;
  saved: { brief: GenerateRequest; generation: GenerationResponse; form: DiscoveryForm; planId: string } | null;
}
const KEY = "nyc-discover-session-v1";
const initial: DiscoverySession = { mode: "new", seen: [], visited: [], excluded: [], locked: [], completed: [], outing: false, promptDismissed: false, feedback: false, saved: null };
let current = initial;
let loaded = false;
let sessionDate = nycDate();
let dayTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function validSaved(saved: DiscoverySession["saved"]) {
  if (!saved) return null;
  const brief = saved.brief;
  const form = saved.form;
  const plans = saved.generation?.plans;
  return brief && !Number.isNaN(Date.parse(brief.start_at)) && brief.coordinates &&
    typeof brief.location_label === "string" && form && Array.isArray(form.moods) &&
    Array.isArray(plans) && plans.some((plan) => plan.id === saved.planId) &&
    plans.every((plan) => Array.isArray(plan.steps) && plan.steps.every((step) =>
      step.coordinates && step.travel_before && typeof step.name === "string" &&
      !Number.isNaN(Date.parse(step.start_at)) && !Number.isNaN(Date.parse(step.end_at))))
    ? saved : null;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    try {
      const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
      if (raw?.date === nycDate() && raw.session && ["easy", "new", "surprise"].includes(raw.session.mode)) {
        const s = raw.session;
        if ([s.seen, s.visited, s.excluded, s.locked, s.completed].every((v) => Array.isArray(v) && v.every((i) => typeof i === "string"))) {
          current = { ...initial, ...s, saved: validSaved(s.saved) };
        }
      }
    } catch { /* Session memory remains available if storage is blocked. */ }
  }
  if (!dayTimer) dayTimer = setInterval(() => {
    if (sessionDate !== nycDate()) resetDiscoverySession();
  }, 60_000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(dayTimer); dayTimer = undefined; }
  };
}
export function getDiscoverySession() { return current; }
export function useDiscoverySession() { return useSyncExternalStore(subscribe, getDiscoverySession, () => initial); }
export function saveDiscoverySession(update: Partial<DiscoverySession>) {
  current = { ...current, ...update };
  for (const key of ["seen", "visited"] as const) current[key] = [...new Set(current[key])].slice(-200);
  try { sessionStorage.setItem(KEY, JSON.stringify({ date: nycDate(), session: current })); } catch { /* In-memory fallback. */ }
  listeners.forEach((listener) => listener());
}
export function resetDiscoverySession() {
  current = { ...initial };
  sessionDate = nycDate();
  loaded = true;
  try { sessionStorage.removeItem(KEY); } catch { /* Storage is optional. */ }
  listeners.forEach((listener) => listener());
}
