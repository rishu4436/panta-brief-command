import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIEF_RATE_LIMIT } from "@/lib/brief-modes";
import {
  __setSharedStoreForTests,
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
  calls = 0;
  private guard() {
    this.calls += 1;
    if (this.fail) throw new Error("upstash down");
  }
  async incrWindow(key: string, windowMs: number) {
    this.guard();
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
    this.guard();
    const v = this.kv.get(key);
    return v == null ? null : (JSON.parse(v) as T);
  }
  async setJson(key: string, value: unknown) {
    this.guard();
    this.kv.set(key, JSON.stringify(value));
  }
  async pushList(key: string, value: unknown, max: number) {
    this.guard();
    const l = [JSON.stringify(value), ...(this.lists.get(key) ?? [])].slice(0, max);
    this.lists.set(key, l);
  }
  async readList<T>(key: string, max: number) {
    this.guard();
    return (this.lists.get(key) ?? []).slice(0, max).map((r) => JSON.parse(r) as T);
  }
}

afterEach(() => {
  __setSharedStoreForTests(undefined);
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("store selection", () => {
  it("uses Upstash only when both URL and token are set (either naming)", () => {
    expect(upstashFromEnv({})).toBeNull();
    expect(upstashFromEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io" })).toBeNull();
    expect(upstashFromEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })?.kind).toBe("redis");
    expect(upstashFromEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" })?.kind).toBe("redis");
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
