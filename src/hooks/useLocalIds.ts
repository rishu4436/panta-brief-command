"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  notifyStorage,
  parseIds,
  pushRecent,
  readRaw,
  subscribeStorage,
  toggleWatch,
} from "@/lib/storage";

/** localStorage-backed id list; the raw string is the stable snapshot. */
function useStoredIds(kind: "watch" | "recent"): string[] {
  const raw = useSyncExternalStore(
    subscribeStorage,
    () => readRaw(kind),
    () => "",
  );
  return useMemo(() => parseIds(raw), [raw]);
}

export function useWatchlist() {
  const ids = useStoredIds("watch");
  const toggle = useCallback((marketId: string) => {
    const next = toggleWatch(marketId);
    notifyStorage();
    return next;
  }, []);
  return { ids, toggle, has: (id: string) => ids.includes(id) };
}

export function useRecents() {
  const ids = useStoredIds("recent");
  const push = useCallback((marketId: string) => {
    const next = pushRecent(marketId);
    notifyStorage();
    return next;
  }, []);
  return { ids, push };
}
