"use client";
import { useSyncExternalStore } from "react";
import { nycDate } from "./nyc-time";

function subscribe(listener: () => void) {
  const timer = setInterval(listener, 60_000);
  window.addEventListener("focus", listener);
  return () => { clearInterval(timer); window.removeEventListener("focus", listener); };
}
// Static HTML has no date claim; hydration and long-lived tabs use New York's current date.
export function useNYCDate() {
  return useSyncExternalStore(subscribe, () => nycDate(), () => "");
}
