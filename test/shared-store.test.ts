import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIEF_RATE_LIMIT } from "@/lib/brief-modes";
import {
  __resetStoreHealthForTests,
  __setSharedStoreForTests,
  guardStore,
  STORE_TIMEOUT_MS,
  storeHeaderValue,
  storeStatus,
  limitShared,
  SharedCache,
  upstashFromEnv,
  type SharedStore,
} from "@/lib/shared-store";

/** In-memory stand-in for Upstash, shared like Redis would be across "instances". */
class FakeStore implements SharedStore {
  readonly kind = "redis" as const;
  windows = new Map<string, { count: number; expiresAt: number }>();
  kv = new Map<string, string>();
  lists = new Map<string, string[]>();
  fail = false;
  /** Simulate a hung Upstash call (never resolves). */
  hang = false;
  calls = 0;
  private async guard() {
    this.calls += 1;
    if (this.hang) await new Promise(() => {});
    if (this.fail) throw new Error("upstash down");
  }
  async incrWindow(key: string, windowMs: number) {
    await this.guard();
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || w.expiresAt <= now) {
      this.windows.set(key, { count: 1, expiresAt: now + windowMs });
      return { count: 1, ttlMs: windowMs };
    }
    w.count += 1;
    return { count: w.count, ttlMs: w.expiresAt - now };
  }
  async getJson<T>(key: string) {
    await this.guard();
    const v = this.kv.get(key);
    return v == null ? null : (JSON.parse(v) as T);
  }
  async setJson(key: string, value: unknown) {
    await this.guard();
    this.kv.set(key, JSON.stringify(value));
  }
  async pushList(key: string, value: unknown, max: number) {
    await this.guard();
    const l = [JSON.stringify(value), ...(this.lists.get(key) ?? [])].slice(0, max);
    this.lists.set(key, l);
  }
  async readList<T>(key: string, max: number) {
    await this.guard();
    return (this.lists.get(key) ?? []).slice(0, max).map((r) => JSON.parse(r) as T);
  }
}

afterEach(() => {
  __setSharedStoreForTests(undefined);
  __resetStoreHealthForTests();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("store selection", () => {
  it("uses Upstash only when both URL and token are set (either naming)", () => {
    expect(upstashFromEnv({})).toBeNull();
    expect(upstashFromEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io" })).toBeNull();
    expect(upstashFromEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", VERCEL: "1", VERCEL_URL: "briefcommand-test.vercel.app" })?.kind).toBe("redis");
    expect(upstashFromEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t", VERCEL: "1", VERCEL_URL: "briefcommand-test.vercel.app" })?.kind).toBe("redis");
  });
});

describe("limitShared", () => {
  it("memory path when no store is configured", async () => {
    __setSharedStoreForTests(null);
    const key = `mem-${Math.random()}`;
    const a = await limitShared(key, 2, 60_000);
    const b = await limitShared(key, 2, 60_000);
    const c = await limitShared(key, 2, 60_000);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
    expect(a.store).toBe("memory");
    expect(c.retryAfterSec).toBeGreaterThan(0);
  });

  it("shared path: the count lives in the store, so separate instances share it", async () => {
    const store = new FakeStore();
    __setSharedStoreForTests(store);
    const r1 = await limitShared("ip1", 2, 60_000);
    const r2 = await limitShared("ip1", 2, 60_000);
    const r3 = await limitShared("ip1", 2, 60_000);
    expect([r1.ok, r2.ok, r3.ok]).toEqual([true, true, false]);
    expect(r1).toMatchObject({ store: "redis", remaining: 1, limit: 2 });
    expect(r3.retryAfterSec).toBeGreaterThan(0);
    expect(store.windows.get("rl:ip1")?.count).toBe(3);
  });

  it("falls back to memory when the store errors", async () => {
    const store = new FakeStore();
    store.fail = true;
    __setSharedStoreForTests(store);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await limitShared(`down-${Math.random()}`, 2, 60_000);
    expect(r).toMatchObject({ ok: true, store: "memory" });
  });
});

describe("SharedCache", () => {
  it("writes to and serves from the shared store", async () => {
    const store = new FakeStore();
    __setSharedStoreForTests(store);
    const fn = vi.fn(async () => ({ n: 1 }));
    const a = new SharedCache<{ n: number }>("t", 60_000);
    expect(await a.getOrCompute("k", fn)).toMatchObject({ cached: false, store: "redis" });
    // A second "instance" (fresh local cache) hits the shared copy.
    const b = new SharedCache<{ n: number }>("t", 60_000);
    expect(await b.getOrCompute("k", fn)).toMatchObject({ value: { n: 1 }, cached: true, store: "redis" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("memory mode dedupes in-flight calls and caches locally", async () => {
    __setSharedStoreForTests(null);
    const fn = vi.fn(async () => 7);
    const c = new SharedCache<number>("m", 60_000);
    const [x, y] = await Promise.all([c.getOrCompute("k", fn), c.getOrCompute("k", fn)]);
    expect(x.value).toBe(7);
    expect(y.value).toBe(7);
    expect((await c.getOrCompute("k", fn)).cached).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("/api/brief with a shared store", () => {
  it("enforces the limit from the store and sends rate-limit headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("upstream must not be called");
    }));
    const store = new FakeStore();
    vi.resetModules();
    // The route must see the same module instance we inject into.
    (await import("@/lib/shared-store")).__setSharedStoreForTests(store);
    const { POST } = await import("@/app/api/brief/route");
    const req = () =>
      new NextRequest("http://localhost/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
        body: JSON.stringify({ marketId: "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB", mode: "moon" }),
      });
    // Another instance already used all but one request of this IP's window.
    store.windows.set("rl:brief:198.51.100.9", { count: BRIEF_RATE_LIMIT - 1, expiresAt: Date.now() + 30_000 });
    const ok = await POST(req());
    expect(ok.status).toBe(400);
    expect(ok.headers.get("x-ratelimit-limit")).toBe(String(BRIEF_RATE_LIMIT));
    expect(ok.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(ok.headers.get("x-ratelimit-store")).toBe("redis");
    const blocked = await POST(req());
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(blocked.headers.get("retry-after"))).toBeLessThanOrEqual(30);
  });
});

describe("fail fast + explicit status", () => {
  afterEach(() => __resetStoreHealthForTests());

  it("a hung Redis call times out quickly and falls back to memory", async () => {
    const store = new FakeStore();
    store.hang = true;
    __setSharedStoreForTests(store);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = Date.now();
    const r = await limitShared(`hang-${Math.random()}`, 2, 60_000);
    const ms = Date.now() - t0;
    expect(r).toMatchObject({ ok: true, store: "memory" });
    expect(ms).toBeLessThan(STORE_TIMEOUT_MS + 400);
    const st = storeStatus();
    expect(st).toMatchObject({ mode: "redis", configured: true, ephemeral: false });
    expect(st.lastError).toMatch(/rate limit: StoreTimeoutError/);
    expect(st.warning).toMatch(/failing: circuit open/);
    expect(storeHeaderValue(r.store)).toBe("mode=memory; configured=true; shared=false; fallback=true");
  });

  it("cache read timeout still computes and serves the value", async () => {
    const store = new FakeStore();
    store.hang = true;
    __setSharedStoreForTests(store);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = new SharedCache<number>("hang", 60_000);
    const r = await c.getOrCompute("k", async () => 3);
    expect(r).toMatchObject({ value: 3, cached: false, store: "memory" });
  });

  it("a Redis error is recorded without credentials", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "briefcommand-test.vercel.app");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok-SECRET-123");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://x.upstash.io");
    await expect(
      guardStore("probe", async () => {
        throw new Error("401 for token tok-SECRET-123 at https://x.upstash.io");
      }),
    ).rejects.toThrow();
    const st = storeStatus();
    expect(st.lastError).toContain("[redacted]");
    expect(st.lastError).not.toContain("tok-SECRET-123");
    expect(st.env).toEqual({ url: "UPSTASH_REDIS_REST_URL", token: "UPSTASH_REDIS_REST_TOKEN" });
    vi.unstubAllEnvs();
  });

  it("success records lastOkAt and clears the warning", async () => {
    __setSharedStoreForTests(new FakeStore());
    await limitShared(`ok-${Math.random()}`, 2, 60_000);
    const st = storeStatus();
    expect(st.lastOkAt).not.toBeNull();
    expect(st.warning).toBeNull();
    expect(storeHeaderValue("redis")).toBe("mode=redis; configured=true; shared=true");
  });

  it("memory mode (local/test, no env) is explicit about being ephemeral", () => {
    __setSharedStoreForTests(undefined);
    const st = storeStatus({ NODE_ENV: "production" });
    expect(st).toMatchObject({ mode: "memory", configured: false, ephemeral: true, production: true });
    expect(st.env).toEqual({ url: null, token: null });
    expect(st.warning).toMatch(/not shared between instances/);
  });

  it("KV_* aliases count as configured", () => {
    __setSharedStoreForTests(undefined);
    expect(storeStatus({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t", VERCEL: "1", VERCEL_URL: "briefcommand-test.vercel.app" })).toMatchObject({
      configured: true,
      env: { url: "KV_REST_API_URL", token: "KV_REST_API_TOKEN" },
    });
  });

  it("the Upstash client is built with no retries and an abort timeout", async () => {
    vi.resetModules();
    const ctor = vi.fn();
    vi.doMock("@upstash/redis", () => ({
      Redis: class {
        constructor(cfg: unknown) {
          ctor(cfg);
        }
      },
    }));
    const mod = await import("@/lib/shared-store");
    mod.upstashFromEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", VERCEL: "1", VERCEL_URL: "briefcommand-test.vercel.app" });
    const cfg = ctor.mock.calls[0][0] as { retry: { retries: number }; signal: () => AbortSignal };
    expect(cfg.retry).toEqual({ retries: 0 });
    expect(typeof cfg.signal).toBe("function");
    expect(cfg.signal()).toBeInstanceOf(AbortSignal);
    vi.doUnmock("@upstash/redis");
  });

  it("/api/brief labels a memory-mode response explicitly", async () => {
    vi.resetModules();
    (await import("@/lib/shared-store")).__setSharedStoreForTests(null);
    const { POST } = await import("@/app/api/brief/route");
    const res = await POST(
      new NextRequest("http://localhost/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
        body: JSON.stringify({ marketId: "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB", mode: "moon" }),
      }),
    );
    expect(res.headers.get("x-ratelimit-store")).toBe("memory");
    expect(res.headers.get("x-store-status")).toBe("mode=memory; configured=false; shared=false");
  });
});
