/**
 * Tiny in-memory fixed-window limiter + TTL cache for route handlers.
 * Per server instance only: on serverless/multi-instance deployments each
 * instance keeps its own counters. Good enough to stop casual abuse; use a
 * shared store (e.g. Redis/Upstash) for hard guarantees.
 */

const MAX_KEYS = 5_000;

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { ok: true; remaining: number } | { ok: false; retryAfterSec: number } {
  if (windows.size > MAX_KEYS) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
    if (windows.size > MAX_KEYS) windows.clear();
  }
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  if (w.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  w.count += 1;
  return { ok: true, remaining: limit - w.count };
}

/** Client IP from x-forwarded-for (first hop), then x-real-ip, else "unknown". */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}

export class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();
  private inflight = new Map<string, Promise<V>>();

  constructor(
    private ttlMs: number,
    private maxEntries = 500,
  ) {}

  get(key: string, now: number = Date.now()): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, now: number = Date.now()) {
    if (this.store.size >= this.maxEntries) {
      for (const [k, v] of this.store) if (v.expiresAt <= now) this.store.delete(k);
      if (this.store.size >= this.maxEntries) {
        const oldest = this.store.keys().next().value;
        if (oldest !== undefined) this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
  }

  /** Cached value, or join an in-flight computation, or start one. */
  async getOrCompute(key: string, fn: () => Promise<V>): Promise<{ value: V; cached: boolean }> {
    const hit = this.get(key);
    if (hit !== undefined) return { value: hit, cached: true };
    const pending = this.inflight.get(key);
    if (pending) return { value: await pending, cached: true };
    const p = fn();
    this.inflight.set(key, p);
    try {
      const value = await p;
      this.set(key, value);
      return { value, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }
}
