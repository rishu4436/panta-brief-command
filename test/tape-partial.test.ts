/**
 * Partial tape: unreadable rows are counted (returned/parsed/dropped), left
 * out of the sample (never turned into zero-size prints), and the signal
 * layer treats the page as a partial sample with capped data quality.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTrades, parseTradesDetailed, parseTradesStrict, TapeDataError } from "@/lib/panta/markets";
import { computeMarketSignals } from "@/lib/panta/signals";
import type { Market } from "@/lib/panta/domain";

const MARKET = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";
const now = Date.now();
const row = (i: number, side: "yes" | "no" = "yes") => ({
  id: `t${i}`,
  marketId: MARKET,
  wallet: `W${i % 3}`,
  isPrimary: true,
  side,
  shares: "10.5",
  sharesBase: "10500000",
  blockTime: Math.floor(now / 1000) - i * 60,
  signature: `sig${i}`,
});
const market: Market = {
  marketId: MARKET,
  title: "Partial tape market",
  category: "sports",
  phase: "primary",
  yesPrice: "0.5",
  noPrice: "0.5",
  resolutionTime: Math.floor(now / 1000) + 86_400,
} as Market;

describe("parseTradesDetailed", () => {
  it("complete page", () => {
    const p = parseTradesDetailed({ items: [row(1), row(2, "no")] });
    expect(p.completeness).toEqual({ returned: 2, parsed: 2, dropped: 0, complete: true });
  });
  it("malformed rows are dropped and counted, never turned into zeros", () => {
    const items = [
      row(1),
      "not-a-row",
      null,
      [1, 2],
      { ...row(3), shares: "abc" }, // numeric field present but not a number
      { ...row(4), sharesBase: "-5" },
      { ...row(5), blockTime: "yesterday" },
      { side: "yes", shares: "3" }, // nothing to place the print
      row(6, "no"),
    ];
    const p = parseTradesDetailed({ items });
    expect(p.completeness).toEqual({ returned: 9, parsed: 2, dropped: 7, complete: false });
    expect(p.trades.map((t) => t.id)).toEqual(["t1", "t6"]);
    for (const t of p.trades) expect(t.shares).toBe(10.5);
    expect(parseTrades({ items }).length).toBe(2);
  });
  it("a row with a missing (not malformed) size is kept with null, not 0", () => {
    const p = parseTradesDetailed({ items: [{ ...row(1), shares: null, sharesBase: undefined }] });
    expect(p.completeness.complete).toBe(true);
    expect(p.trades[0].shares).toBeNull();
  });
  it("strict: page with no readable rows is an error, not an empty tape", () => {
    expect(() => parseTradesStrict({ items: ["x", { foo: 1 }] })).toThrow(TapeDataError);
    expect(() => parseTradesStrict({ nope: [] })).toThrow(TapeDataError);
    expect(parseTradesStrict({ items: [row(1), "x"] }).completeness).toMatchObject({ dropped: 1, complete: false });
  });
});

describe("signals treat a partial page as a partial sample", () => {
  const full = parseTradesDetailed({ items: Array.from({ length: 30 }, (_, i) => row(i + 1, i % 2 ? "no" : "yes")) }).trades;
  it("complete page: completeness carried, no partial reason", () => {
    const s = computeMarketSignals(market, full, now, {
      tapeCompleteness: { returned: 30, parsed: 30, dropped: 0, complete: true },
    });
    expect(s.tape.completeness?.complete).toBe(true);
    expect(s.dataQuality.reasons.join(" ")).not.toMatch(/Partial tape/);
  });
  it("a few unreadable rows cap data quality at MEDIUM with a reason", () => {
    const s = computeMarketSignals(market, full, now, {
      tapeCompleteness: { returned: 33, parsed: 30, dropped: 3, complete: false },
    });
    expect(s.tape.count).toBe(30); // only readable rows are counted
    expect(s.dataQuality.grade).not.toBe("high");
    expect(s.dataQuality.reasons).toContain("Partial tape: 3 of 33 rows unreadable (left out, not counted)");
  });
  it("≥25% unreadable caps data quality at LOW", () => {
    const s = computeMarketSignals(market, full, now, {
      tapeCompleteness: { returned: 40, parsed: 30, dropped: 10, complete: false },
    });
    expect(s.dataQuality.grade).toBe("low");
  });
  it("unknown completeness stays null (not assumed complete)", () => {
    expect(computeMarketSignals(market, full, now).tape.completeness).toBeNull();
  });
});

describe("/api/brief reports a partial tape", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it("partial page → signals.tape.completeness + capped quality in the brief", async () => {
    process.env.PANTA_API_KEY = "pk_test_vitest_dummy";
    const items = [...Array.from({ length: 30 }, (_, i) => row(i + 1, i % 2 ? "no" : "yes")), "garbage", { ...row(99), shares: "NaN" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(JSON.stringify(String(url).includes("/trades/") ? { items } : { ...market }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { POST } = await import("@/app/api/brief/route");
    const res = await POST(
      new NextRequest("http://localhost/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json", "x-vercel-forwarded-for": "198.51.100.77" },
        body: JSON.stringify({ marketId: MARKET, mode: "desk" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals.tape.completeness).toEqual({ returned: 32, parsed: 30, dropped: 2, complete: false });
    expect(body.signals.dataQuality.reasons).toContain("Partial tape: 2 of 32 rows unreadable (left out, not counted)");
    expect(body.narrative).toMatch(/Partial tape: 2 of 32 rows unreadable/);
  });
});
