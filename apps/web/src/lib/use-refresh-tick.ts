"use client";
import { useCallback, useEffect, useState } from "react";

// Changes every five minutes, whenever the tab becomes visible, and on retry, so listings can refetch.
export function useRefreshTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setTick((n) => n + 1); };
    const timer = setInterval(refresh, 5 * 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  return [tick, retry] as const;
}
