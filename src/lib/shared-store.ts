import "server-only";

/**
 * Shared store for route handlers: rate-limit windows, the brief cache and
 * (later) feedback / usage events.
 *
 * - Upstash Redis over REST when UPSTASH_REDIS_REST_URL + _TOKEN (or the
 *   Vercel KV names KV_REST_API_URL + KV_REST_API_TOKEN) are set: counters
 *   and cached briefs are shared by every serverless instance.
 * - Otherwise (and whenever a Redis call fails) the per-instance in-memory
 *   path in ./rate-limit.ts is used, so the app never depends on the store
 *   to serve a request.
 */

import { Redis } from "@upstash/redis";
import { rateLimit, TtlCache } from "./rate-limit";

export type StoreKind = "redis" | "memory";

/** Minimal surface the app needs; the Upstash client is adapted to it. */
export interface SharedStore {
  readonly kind: "redis";
  /** Atomic fixed window: INCR the key, set the expiry on the first hit; returns count + ms left. */
  incrWindow(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlMs: number): Promise<void>;
  /** Append to a capped list (newest first). */
  pushList(key: string, value: unknown, max: number): Promise<void>;
  readList<T>(key: string, max: number): Promise<T[]>;
}

const WINDOW_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); t = tonumber(ARGV[1]) end
return {c, t}
`;

const PREFIX = "pbc:";

export function upstashFromEnv(env: Record<string, string | undefined> = process.env): SharedStore | null {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    kind: "redis",
    async incrWindow(key, windowMs) {
      const [count, ttl] = (await redis.eval(WINDOW_SCRIPT, [PREFIX + key], [String(windowMs)])) as [number, number];
      return { count: Number(count), ttlMs: Math.max(0, Number(ttl)) };
    },
    async getJson<T>(key: string) {
      const raw = await redis.get<string>(PREFIX + key);
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    async setJson(key, value, ttlMs) {
      await redis.set(PREFIX + key, JSON.stringify(value), { px: ttlMs });
    },
    async pushList(key, value, max) {
      const p = redis.pipeline();
      p.lpush(PREFIX + key, JSON.stringify(value));
      p.ltrim(PREFIX + key, 0, max - 1);
      await p.exec();
    },
    async readList<T>(key: string, max: number) {
      const rows = await redis.lrange<string>(PREFIX + key, 0, max - 1);
      const out: T[] = [];
      for (const r of rows) {
        try {
          out.push(JSON.parse(r) as T);
        } catch {
          /* skip corrupt row */
        }
      }
      return out;
    },
  };
}

let override: SharedStore | null | undefined;
let fromEnv: SharedStore | null | undefined;

/** The configured shared store, or null (in-memory mode). */
export function sharedStore(): SharedStore | null {
  if (override !== undefined) return override;
  if (fromEnv === undefined) fromEnv = upstashFromEnv();
  return fromEnv;
}

/** Tests only: inject a fake store (or null for memory mode); undefined restores env. */
export function __setSharedStoreForTests(store: SharedStore | null | undefined) {
  override = store;
}

const warned = new Set<string>();
function warnOnce(what: string, e: unknown) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[shared-store] ${what} failed, using in-memory fallback:`, e instanceof Error ? e.message : e);
}

export type LimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the window resets. */
  resetAt: number;
  retryAfterSec: number;
  store: StoreKind;
};

/** Fixed-window limit shared across instances when the store is configured. */
export async function limitShared(key: string, limit: number, windowMs: number): Promise<LimitResult> {
  const store = sharedStore();
  const now = Date.now();
  if (store) {
    try {
      const { count, ttlMs } = await store.incrWindow(`rl:${key}`, windowMs);
      const ok = count <= limit;
      return {
        ok,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt: now + ttlMs,
        retryAfterSec: ok ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
        store: "redis",
      };
    } catch (e) {
      warnOnce("rate limit", e);
    }
  }
  const r = rateLimit(key, limit, windowMs, now);
  return r.ok
    ? { ok: true, limit, remaining: r.remaining, resetAt: now + windowMs, retryAfterSec: 0, store: "memory" }
    : { ok: false, limit, remaining: 0, resetAt: now + r.retryAfterSec * 1000, retryAfterSec: r.retryAfterSec, store: "memory" };
}

/**
 * Cache with in-flight dedupe. The shared layer (Redis) is read first and
 * written after compute; the per-instance TtlCache always backs it.
 */
export class SharedCache<V> {
  private local: TtlCache<V>;
  private inflight = new Map<string, Promise<V>>();

  constructor(
    private namespace: string,
    private ttlMs: number,
  ) {
    this.local = new TtlCache<V>(ttlMs);
  }

  async getOrCompute(key: string, fn: () => Promise<V>): Promise<{ value: V; cached: boolean; store: StoreKind }> {
    const store = sharedStore();
    const full = `${this.namespace}:${key}`;
    if (store) {
      try {
        const hit = await store.getJson<V>(full);
        if (hit != null) return { value: hit, cached: true, store: "redis" };
      } catch (e) {
        warnOnce("cache read", e);
      }
    }
    const local = this.local.get(full);
    if (local !== undefined) return { value: local, cached: true, store: "memory" };
    const pending = this.inflight.get(full);
    if (pending) return { value: await pending, cached: true, store: store ? "redis" : "memory" };
    const p = fn();
    this.inflight.set(full, p);
    try {
      const value = await p;
      this.local.set(full, value);
      let wrote: StoreKind = "memory";
      if (store) {
        try {
          await store.setJson(full, value, this.ttlMs);
          wrote = "redis";
        } catch (e) {
          warnOnce("cache write", e);
        }
      }
      return { value, cached: false, store: wrote };
    } finally {
      this.inflight.delete(full);
    }
  }
}
