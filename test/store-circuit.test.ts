/**
 * P2 #5: a hanging or failing Redis must cost at most one STORE_TIMEOUT_MS
 * per request, and nothing for later calls while the circuit is open.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedStore } from "@/lib/shared-store";

class HangingStore implements SharedStore {
  readonly kind = "redis" as const;
  mode: "hang" | "fail" | "ok" = "hang";
  calls = 0;
  private async guard() {
    this.calls += 1;
    if (this.mode === "hang") await new Promise(() => {});
    if (this.mode === "fail") throw new Error("ECONNREFUSED upstash");
  }
  async incrWindow() {
    await this.guard();
    return { count: 1, ttlMs: 60_000 };
  }
  async getJson<T>() {
    await this.guard();
    return null as T | null;
  }
  async setJson() {
    await this.guard();
  }
  async pushList() {
    await this.guard();
  }
  async readList<T>() {
    await this.guard();
    return [] as T[];
  }
}

const MARKET = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function load(store: SharedStore | null) {
  vi.resetModules();
  const mod = await import("@/lib/shared-store");
  mod.__setSharedStoreForTests(store);
  return mod;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("EVIDENCE_LOG_DIR", mkdtempSync(path.join(os.tmpdir(), "pbc-circuit-")));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("circuit breaker", () => {
  it("hanging Redis: first call waits the timeout, the next calls skip it instantly", async () => {
    const store = new HangingStore();
    const m = await load(store);
    const t0 = Date.now();
    await m.limitShared("ip-a", 5, 60_000);
    const first = Date.now() - t0;
    expect(first).toBeGreaterThanOrEqual(m.STORE_TIMEOUT_MS - 20);
    expect(first).toBeLessThan(m.STORE_TIMEOUT_MS + 300);

    const t1 = Date.now();
    const cache = new m.SharedCache<number>("c", 60_000);
    for (let i = 0; i < 10; i++) {
      expect((await m.limitShared(`ip-${i}`, 5, 60_000)).store).toBe("memory");
      expect(await cache.getOrCompute(`k${i}`, async () => i)).toMatchObject({ value: i, store: "memory" });
    }
    expect(Date.now() - t1).toBeLessThan(100);
    expect(store.calls).toBe(1);
    const st = m.storeStatus();
    expect(st.circuit).toMatchObject({ state: "open", consecutiveFailures: 1 });
    expect(st.circuit.skipped).toBeGreaterThanOrEqual(30);
    expect(st.warning).toMatch(/circuit open/);
  });

  it("backoff doubles per consecutive failure up to the cap; a successful probe closes it", async () => {
    const store = new HangingStore();
    store.mode = "fail";
    const m = await load(store);
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const openFor = () => Date.parse(m.storeStatus().circuit.openUntil!) - now;

    await m.limitShared("x", 5, 60_000);
    expect(openFor()).toBe(m.CIRCUIT_BASE_MS);
    now += m.CIRCUIT_BASE_MS; // half-open: one probe
    expect(m.storeStatus().circuit.state).toBe("half-open");
    await m.limitShared("x", 5, 60_000);
    expect(store.calls).toBe(2);
    expect(openFor()).toBe(2 * m.CIRCUIT_BASE_MS);
    for (let i = 0; i < 10; i++) {
      now += m.CIRCUIT_MAX_MS;
      await m.limitShared("x", 5, 60_000);
    }
    expect(openFor()).toBe(m.CIRCUIT_MAX_MS);

    store.mode = "ok";
    now += m.CIRCUIT_MAX_MS;
    expect((await m.limitShared("x", 5, 60_000)).store).toBe("redis");
    expect(m.storeStatus().circuit).toMatchObject({ state: "closed", consecutiveFailures: 0, openUntil: null });
  });

  it("half-open lets exactly one probe through; concurrent calls fall back without waiting", async () => {
    const store = new HangingStore();
    store.mode = "fail";
    const m = await load(store);
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await m.limitShared("y", 5, 60_000);
    now += m.CIRCUIT_BASE_MS;
    store.mode = "hang";
    const probe = m.limitShared("y", 5, 60_000); // hangs until timeout
    const t0 = performance.now();
    const others = await Promise.all([m.limitShared("y1", 5, 60_000), m.limitShared("y2", 5, 60_000)]);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(others.map((r) => r.store)).toEqual(["memory", "memory"]);
    expect(store.calls).toBe(2);
    expect((await probe).store).toBe("memory");
  });
});

describe("routes stay bounded with a hanging Redis", () => {
  it("/api/brief (limit + cache read + cache write = 3 store calls) waits at most one timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/trades/")
          ? json({ items: [], nextCursor: null })
          : json({ marketId: MARKET, title: "T", phase: "primary", status: "primary", yesPrice: "0.5", noPrice: "0.5", resolutionTime: Math.floor(Date.now() / 1000) + 86_400 }),
      ),
    );
    const store = new HangingStore();
    const m = await load(store);
    const { POST } = await import("@/app/api/brief/route");
    const req = (ip: string, mode: string) =>
      new NextRequest("http://localhost/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ marketId: MARKET, mode }),
      });
    const t0 = Date.now();
    const res = await POST(req("10.9.0.1", "flow"));
    const first = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-store")).toBe("memory");
    expect(first).toBeLessThan(m.STORE_TIMEOUT_MS + 400); // not 3 × 700ms
    expect(store.calls).toBe(1);
    // Later requests on this instance don't wait at all.
    const t1 = Date.now();
    expect((await POST(req("10.9.0.2", "risk"))).status).toBe(200);
    expect(Date.now() - t1).toBeLessThan(300);
    expect(store.calls).toBe(1);
  });

  it("/api/events (limit + evidence push = 2 store calls) waits at most one timeout", async () => {
    const store = new HangingStore();
    const m = await load(store);
    const { POST } = await import("@/app/api/events/route");
    const req = (ip: string) =>
      new NextRequest("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ anonId: "anon-1234-abcd", event: "visit", path: "/desk" }),
      });
    const t0 = Date.now();
    const res = await POST(req("10.9.1.1"));
    expect(res.status).toBe(204);
    expect(res.headers.get("x-evidence-store")).toMatch(/mode=file; configured=true; shared=false; fallback=true/);
    expect(Date.now() - t0).toBeLessThan(m.STORE_TIMEOUT_MS + 300);
    expect(store.calls).toBe(1);
    const t1 = Date.now();
    expect((await POST(req("10.9.1.2"))).status).toBe(204);
    expect(Date.now() - t1).toBeLessThan(150);
    expect(store.calls).toBe(1);
  });
});
