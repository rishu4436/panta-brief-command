/**
 * Phase 7 production-coherence regressions (resolved outcome, settlement card,
 * category labels, losing positions). Each test fails on the pre-fix code.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Position } from "@/lib/panta/domain";
import { categoryLabel, shouldShowCategoryChip } from "@/lib/format";
import { fetchCatalog } from "@/lib/panta/markets";
import { marketProbability } from "@/lib/panta/prices";
import { claimReadinessWithResolution, enrichPosition } from "@/lib/panta/position-intel";

const resolvedIntel = { kind: "resolved", label: "Resolved", totalSec: null } as const;
const pos = (side: "yes" | "no", over: Partial<Position> = {}): Position => ({
  marketId: "m1",
  category: null,
  side,
  shares: "10",
  sharesNum: 10,
  phase: "resolved",
  claimable: false,
  claimed: false,
  outcome: null,
  title: "Test market",
  valuation: { price: null, priceSource: null, status: null },
  ...over,
} as Position);

describe("category labels", () => {
  it("formats Panta slugs the same way everywhere", () => {
    expect(categoryLabel("sports")).toBe("Sports");
    expect(categoryLabel("pop-culture")).toBe("Pop Culture");
    expect(categoryLabel("space-universe")).toBe("Space Universe");
    expect(categoryLabel("")).toBe("");
    expect(categoryLabel(null)).toBe("");
  });

  it("hides Panta's default 'sports' category on finance / crypto markets, keeps real sports", () => {
    expect(shouldShowCategoryChip("sports", "Will Dangote Refinery be valued at over $60 billion before March 31, 2027 ?")).toBe(false);
    expect(shouldShowCategoryChip("sports", "Will $ANSEM reach a $1B market cap by December 31, 2026?")).toBe(false);
    expect(shouldShowCategoryChip("sports", "Will Bitcoin hit $65,000 in the next 30 minutes?")).toBe(false);
    expect(shouldShowCategoryChip("sports", "Haaland 8+ points, GW6")).toBe(true);
    expect(shouldShowCategoryChip("sports", "Will Arsenal beat Leeds United on October 10, 2026?")).toBe(true);
    expect(shouldShowCategoryChip("crypto", "Will bitcoin hit $100,000 by 31 Dec 2026")).toBe(true);
  });
});

describe("resolved outcome survives the client catalog parse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the server-derived outcome (serialized rows carry outcome, not yesWins)", async () => {
    const items = [
      { marketId: "A", title: "Resolved NO", category: "sports", phase: "resolved", status: "resolved", resolved: true, outcome: "no", sources: { list: true, chain: true, detail: false } },
      { marketId: "B", title: "Live", category: "sports", phase: "secondary", resolved: false, outcome: "yes" },
      { marketId: "C", title: "Bogus outcome", category: "sports", phase: "resolved", resolved: true, outcome: "maybe" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items, counts: {}, sources: {}, generatedAt: "x" }), { status: 200 })));
    const { items: out } = await fetchCatalog();
    expect(out.find((m) => m.marketId === "A")?.outcome).toBe("no");
    expect(out.find((m) => m.marketId === "A")?.sources?.chain).toBe(true);
    // An outcome on an unresolved row, or a non yes/no value, is ignored.
    expect(out.find((m) => m.marketId === "B")?.outcome).toBeUndefined();
    expect(out.find((m) => m.marketId === "C")?.outcome).toBeUndefined();
  });
});

describe("settlement card", () => {
  it("resolved with a known winner but no prices settles at 1 / 0", () => {
    expect(marketProbability({ phase: "resolved", resolved: true, outcome: "no" })).toMatchObject({ yes: 0, no: 1, source: "settled", reason: null });
    expect(marketProbability({ phase: "resolved", resolved: true, outcome: "yes" })).toMatchObject({ yes: 1, no: 0, source: "settled" });
  });

  it("still says unavailable without a winner, and Panta's own prices win when present", () => {
    expect(marketProbability({ phase: "resolved", resolved: true })).toMatchObject({ yes: null, source: "unavailable", reason: "missing_prices" });
    expect(marketProbability({ phase: "resolved", resolved: true, outcome: "yes", yesPrice: "0.98", noPrice: "0.02" })).toMatchObject({ yes: 0.98, source: "settled" });
    // Never applied before resolution.
    expect(marketProbability({ phase: "secondary", resolved: false, outcome: "yes" })).toMatchObject({ yes: null, reason: "not_applicable" });
  });
});

describe("claim readiness on resolved markets", () => {
  it("a losing position is 'Lost · nothing to claim', not 'Not yet claimable'", () => {
    expect(claimReadinessWithResolution(pos("yes"), "resolved", resolvedIntel, "no")).toEqual({ status: "lost", label: "Lost · nothing to claim" });
    expect(claimReadinessWithResolution(pos("no"), "resolved", resolvedIntel, "no")).toEqual({ status: "not_yet", label: "Not yet claimable" });
    expect(claimReadinessWithResolution(pos("yes"), "resolved", resolvedIntel, null)).toEqual({ status: "not_yet", label: "Not yet claimable" });
  });

  it("Panta's claimable / claimed flags always win", () => {
    expect(claimReadinessWithResolution(pos("yes", { claimable: true }), "resolved", resolvedIntel, "no").status).toBe("claimable");
    expect(claimReadinessWithResolution(pos("yes", { claimed: true }), "resolved", resolvedIntel, "no").status).toBe("claimed");
  });

  it("enrichPosition passes the market outcome through", () => {
    const row = enrichPosition(pos("yes"), undefined, { marketId: "m1", title: "T", category: "", phase: "resolved", resolved: true, outcome: "no" }, Date.now());
    expect(row.claim.status).toBe("lost");
  });
});

describe("brief market sanitizer", () => {
  it("keeps the resolved winner so the brief matches the market page", async () => {
    const { sanitizeMarket } = await import("@/lib/panta/sanitize");
    const { computeMarketSignals } = await import("@/lib/panta/signals");
    const m = sanitizeMarket({ marketId: "m1", title: "T", category: "sports", phase: "resolved", resolved: true, outcome: "no" });
    expect(m.outcome).toBe("no");
    const s = computeMarketSignals(m, [], Date.now());
    expect(s.outcome).toBe("no");
    expect(sanitizeMarket({ marketId: "m1", title: "T", category: "", phase: "resolved", outcome: "x" as never }).outcome).toBeUndefined();
  });
});
