"use client";

const WATCH_KEY = "panta-brief:watchlist";
const RECENT_KEY = "panta-brief:recents";
const MAX_RECENTS = 12;

function readIds(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* quota / private mode */
  }
}

export function getWatchlist(): string[] {
  return readIds(WATCH_KEY);
}

export function isWatched(marketId: string): boolean {
  return getWatchlist().includes(marketId);
}

export function toggleWatch(marketId: string): string[] {
  const id = marketId.trim();
  if (!id) return getWatchlist();
  const cur = getWatchlist();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur];
  writeIds(WATCH_KEY, next);
  return next;
}

export function getRecents(): string[] {
  return readIds(RECENT_KEY);
}

export function pushRecent(marketId: string): string[] {
  const id = marketId.trim();
  if (!id) return getRecents();
  const next = [id, ...getRecents().filter((x) => x !== id)].slice(0, MAX_RECENTS);
  writeIds(RECENT_KEY, next);
  return next;
}

export function subscribeStorage(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === WATCH_KEY || e.key === RECENT_KEY || e.key === null) cb();
  };
  const onCustom = () => cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener("panta-brief-storage", onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("panta-brief-storage", onCustom);
  };
}

export function notifyStorage() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("panta-brief-storage"));
}
