import "server-only";

/**
 * Shared store for route handlers: rate-limit windows, the brief cache and
 * (later) feedback / usage events.
 *
 * - Upstash Redis over REST when UPSTASH_REDIS_REST_URL + _TOKEN (or the
 *   Vercel KV names KV_REST_API_URL + KV_REST_API_TOKEN) are set: counters
 *   and cached briefs are shared by every serverless instance.
 * - Otherwise (and whenever a Redis call fails or exceeds
 *   STORE_TIMEOUT_MS) the per-instance in-memory path in ./rate-limit.ts is
 *   used, so the app never depends on the store to serve a request.
 *
 * Fallback is never silent: every response that touched the store reports
 * which one served it (see storeHeaders), and storeStatus() exposes mode,
 * configuration, the last error and an ephemeral-data warning for the admin
 * diagnostics endpoint.
 */

import { Redis } from "@upstash/redis";
import { rateLimit, TtlCache } from "./rate-limit";

export type StoreKind = "redis" | "memory";

/** Hard cap per Redis call; a slow store must not slow requests down. */
export const STORE_TIMEOUT_MS = 700;

const URL_VARS = ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"] as const;
const TOKEN_VARS = ["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"] as const;

function envCreds(env: Record<string, string | undefined>) {
  const urlVar = URL_VARS.find((k) => (env[k] || "").trim());
  const tokenVar = TOKEN_VARS.find((k) => (env[k] || "").trim());
  return {
    url: urlVar ? env[urlVar]!.trim() : "",
    token: tokenVar ? env[tokenVar]!.trim() : "",
    urlVar: urlVar ?? null,
    tokenVar: tokenVar ?? null,
  };
}

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

let warnedUnconfigured = false;

export function upstashFromEnv(env: Record<string, string | undefined> = process.env): SharedStore | null {
  const { url, token } = envCreds(env);
  if (!url || !token) return null;
  const redis = new Redis({
    url,
    token,
    automaticDeserialization: false,
    // Fail fast: no client retries, and every HTTP call is aborted after the cap.
    retry: { retries: 0 },
    signal: () => AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
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
  if (fromEnv === undefined) {
    fromEnv = upstashFromEnv();
    if (!fromEnv && process.env.NODE_ENV === "production" && !warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(`[shared-store] ${EPHEMERAL_WARNING}`);
    }
  }
  return fromEnv;
}

/** Tests only: inject a fake store (or null for memory mode); undefined restores env. */
export function __setSharedStoreForTests(store: SharedStore | null | undefined) {
  override = store;
}

// ---------------------------------------------------------------------------
// Status (per instance) + fail-fast wrapper

type StoreHealth = { lastError: string | null; lastErrorAt: string | null; lastOkAt: string | null; failures: number };
const health: StoreHealth = { lastError: null, lastErrorAt: null, lastOkAt: null, failures: 0 };

/** Error text without credentials (the URL/token never leave the server). */
function safeMessage(e: unknown): string {
  let msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const { url, token } = envCreds(process.env);
  for (const secret of [token, url]) if (secret) msg = msg.split(secret).join("[redacted]");
  return msg.slice(0, 200);
}

const warned = new Set<string>();
function warnOnce(what: string, e: unknown) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[shared-store] ${what} failed, using in-memory fallback:`, safeMessage(e));
}

export class StoreTimeoutError extends Error {
  constructor(op: string) {
    super(`shared store ${op} exceeded ${STORE_TIMEOUT_MS}ms`);
    this.name = "StoreTimeoutError";
  }
}

/**
 * Run one store call with the timeout cap; records success/failure for
 * storeStatus(). Throws on failure so callers fall back explicitly.
 */
export async function guardStore<T>(op: string, fn: () => Promise<T>, timeoutMs = STORE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StoreTimeoutError(op)), timeoutMs);
      }),
    ]);
    health.lastOkAt = new Date().toISOString();
    return out;
  } catch (e) {
    health.lastError = `${op}: ${safeMessage(e)}`;
    health.lastErrorAt = new Date().toISOString();
    health.failures += 1;
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type StoreStatus = {
  /** What serves requests on this instance right now. */
  mode: StoreKind;
  configured: boolean;
  /** Which env var names were found (names only, never values). */
  env: { url: string | null; token: string | null };
  production: boolean;
  timeoutMs: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
  failures: number;
  /** True when rate limits, the brief cache and evidence are per instance / lost on cold start. */
  ephemeral: boolean;
  warning: string | null;
};

export const EPHEMERAL_WARNING =
  "Shared store not configured: rate limits and the brief cache are per instance (memory), and feedback/usage evidence is written to the instance's temporary disk. On Vercel this is not shared between instances and is lost on cold start or redeploy. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.";

export function storeStatus(env: Record<string, string | undefined> = process.env): StoreStatus {
  const c = envCreds(env);
  const configured = override !== undefined ? override !== null : Boolean(c.url && c.token);
  const recentFailure =
    configured && health.lastErrorAt != null && (health.lastOkAt == null || health.lastErrorAt > health.lastOkAt);
  return {
    mode: configured ? "redis" : "memory",
    configured,
    env: { url: c.urlVar, token: c.tokenVar },
    production: env.NODE_ENV === "production" || env.VERCEL_ENV === "production",
    timeoutMs: STORE_TIMEOUT_MS,
    lastError: health.lastError,
    lastErrorAt: health.lastErrorAt,
    lastOkAt: health.lastOkAt,
    failures: health.failures,
    ephemeral: !configured,
    warning: !configured
      ? EPHEMERAL_WARNING
      : recentFailure
        ? "Shared store configured but the last call failed; affected requests fell back to per-instance memory/disk."
        : null,
  };
}

/**
 * Response header describing the store that actually served this request,
 * e.g. "mode=memory; configured=false; shared=false".
 */
export function storeHeaderValue(served: StoreKind | "file"): string {
  const configured = storeStatus().configured;
  const shared = served === "redis";
  return `mode=${served}; configured=${configured}; shared=${shared}${!shared && configured ? "; fallback=true" : ""}`;
}

/** Tests only: reset recorded health. */
export function __resetStoreHealthForTests() {
  health.lastError = null;
  health.lastErrorAt = null;
  health.lastOkAt = null;
  health.failures = 0;
  warned.clear();
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
      const { count, ttlMs } = await guardStore("rate limit", () => store.incrWindow(`rl:${key}`, windowMs));
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
        const hit = await guardStore("cache read", () => store.getJson<V>(full));
        if (hit != null) return { value: hit, cached: true, store: "redis" };
      } catch (e) {
        warnOnce("cache read", e);
      }
    }
    const local = this.local.get(full);
    if (local !== undefined) return { value: local, cached: true, store: "memory" };
    const pending = this.inflight.get(full);
    // Served from this instance's in-flight dedupe, not the shared store.
    if (pending) return { value: await pending, cached: true, store: "memory" };
    const p = fn();
    this.inflight.set(full, p);
    try {
      const value = await p;
      this.local.set(full, value);
      let wrote: StoreKind = "memory";
      if (store) {
        try {
          await guardStore("cache write", () => store.setJson(full, value, this.ttlMs));
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
