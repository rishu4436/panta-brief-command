/**
 * Tape failure is never "no prints": server fetch throws, /api/brief 502s
 * with the upstream detail and does not cache the failure, and the UI state
 * helpers keep failed / empty / loaded apart.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hotTapeSummary, printsLabel, tapeState } from "@/lib/tape-status";

const MARKET = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";
const detail = {
  marketId: MARKET,
  title: "Tape market",
  phase: "primary",
  status: "primary",
  yesPrice: "0.50",
  noPrice: "0.50",
  resolutionTime: Math.floor(Date.now() / 1000) + 86_400,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubPanta(trades: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (String(url).includes("/trades/") ? trades() : json(detail))),
  );
}

describe("getMarketTradesServer", () => {
  it("HTTP 500 → UpstreamError 502 with the upstream code and status", async () => {
    stubPanta(() => json({ code: "UPSTREAM_ERROR" }, 500));
    const { getMarketTradesServer, UpstreamError } = await import("@/lib/panta/server");
    const err = await getMarketTradesServer(MARKET).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ status: 502, code: "UPSTREAM_ERROR" });
    expect(err.detail).toMatch(/trades request failed: HTTP 500/);
  });
  it("unreachable → 502, not []", async () => {
    stubPanta(() => {
      throw new TypeError("fetch failed");
    });
    const { getMarketTradesServer } = await import("@/lib/panta/server");
    await expect(getMarketTradesServer(MARKET)).rejects.toMatchObject({ status: 502, code: "PANTA_UNREACHABLE" });
  });
  it("malformed page → 502 PANTA_TRADES_MALFORMED, not []", async () => {
    stubPanta(() => json({ unexpected: true }));
    const { getMarketTradesServer } = await import("@/lib/panta/server");
    await expect(getMarketTradesServer(MARKET)).rejects.toMatchObject({ status: 502, code: "PANTA_TRADES_MALFORMED" });
  });
  it("a genuine empty page is [] (zero prints)", async () => {
    stubPanta(() => json({ items: [], nextCursor: null }));
    const { getMarketTradesServer } = await import("@/lib/panta/server");
    expect(await getMarketTradesServer(MARKET)).toEqual([]);
  });
});

describe("/api/brief tape failure", () => {
  const req = (ip: string) =>
    new NextRequest("http://localhost/api/brief", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ marketId: MARKET, mode: "flow" }),
    });

  it("502 with the upstream detail, and the failure is not cached", async () => {
    let fail = true;
    stubPanta(() => (fail ? json({ code: "UPSTREAM_ERROR" }, 500) : json({ items: [], nextCursor: null })));
    (await import("@/lib/shared-store")).__setSharedStoreForTests(null);
    const { POST } = await import("@/app/api/brief/route");
    const bad = await POST(req("10.7.0.1"));
    expect(bad.status).toBe(502);
    const body = await bad.json();
    expect(body).toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(body.detail).toMatch(/Panta trades request failed/);
    expect(body.signals).toBeUndefined();
    // Next call recomputes (no cached failure) and a real empty tape is zero prints.
    fail = false;
    const ok = await POST(req("10.7.0.2"));
    expect(ok.status).toBe(200);
    const b = await ok.json();
    expect(b.cached).toBe(false);
    expect(b.signals.tape.count).toBe(0);
  });

  it("client fetchMarketTrades rejects on a malformed page (TanStack keeps it an error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ nope: 1 })));
    const { fetchMarketTrades, TapeDataError } = await import("@/lib/panta/markets");
    await expect(fetchMarketTrades(MARKET)).rejects.toBeInstanceOf(TapeDataError);
  });
  it("client fetchMarketTrades rejects on a 502 from the proxy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "UPSTREAM_ERROR" }, 502)));
    const { fetchMarketTrades } = await import("@/lib/panta/markets");
    await expect(fetchMarketTrades(MARKET)).rejects.toMatchObject({ status: 502 });
  });
});

describe("tape UI state", () => {
  const err = new Error("PANTA_HTTP_500");
  it("failed / empty / loaded are distinct", () => {
    expect(tapeState({ isPending: true, isError: false, data: undefined, error: null })).toEqual({ kind: "loading" });
    expect(tapeState({ isPending: false, isError: true, data: undefined, error: err })).toMatchObject({ kind: "failed" });
    expect(tapeState({ isPending: false, isError: false, data: [], error: null })).toEqual({ kind: "empty" });
    expect(tapeState({ isPending: false, isError: true, data: [], error: err })).toMatchObject({ kind: "failed" });
    expect(tapeState({ isPending: false, isError: true, data: [1, 2], error: err })).toMatchObject({
      kind: "ok",
      count: 2,
      // Readable text from the single code mapping; the raw code is only a ref.
      refreshFailed: "Panta returned an error. Try again shortly. (ref PANTA_HTTP_500)",
    });
  });
  it("prints label never shows 0 for a failed request", () => {
    expect(printsLabel({ kind: "failed", message: "x" })).toBe("Unavailable");
    expect(printsLabel({ kind: "empty" })).toBe("0");
  });
  it("hot tape: all failed is 'unavailable', not quiet", () => {
    const base = { catalogError: false, targets: 3, busy: false, hits: 0 };
    expect(hotTapeSummary({ ...base, failed: 3, succeeded: 0 })?.title).toBe("Tape unavailable");
    expect(hotTapeSummary({ ...base, failed: 1, succeeded: 2 })?.title).toBe("Tape partly unavailable");
    expect(hotTapeSummary({ ...base, failed: 0, succeeded: 3 })).toMatchObject({ title: "Tape quiet" });
    expect(hotTapeSummary({ ...base, failed: 0, succeeded: 3, hits: 4 })).toBeNull();
  });
});
