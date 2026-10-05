/**
 * Position Intelligence: aggregation, exposure, lifecycle, resolution,
 * claim readiness — only over validated bookMark() values. Never fabricates
 * P&L, average entry or cost basis.
 */
import { describe, expect, it } from "vitest";
import type { Market, Position } from "@/lib/panta/domain";
import { marketProbability } from "@/lib/panta/prices";
import {
  claimReadinessWithResolution,
  dataFreshness,
  enrichPosition,
  enrichPositions,
  formatResolutionCountdown,
  LARGEST_UNAVAILABLE_NOTE,
  MARKS_LOADING_NOTE,
  PNL_UNAVAILABLE_NOTE,
  portfolioIntel,
  positionLifecycle,
  resolutionIntel,
} from "@/lib/panta/position-intel";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const NOW_SEC = Math.floor(NOW / 1000);

const pos = (over: Partial<Position> & Pick<Position, "marketId">): Position => ({
  marketId: over.marketId,
  category: null,
  side: over.side ?? "yes",
  shares: over.shares ?? "10",
  sharesNum: over.sharesNum ?? 10,
  phase: over.phase ?? "primary",
  claimable: over.claimable ?? false,
  claimed: over.claimed ?? false,
  outcome: over.outcome ?? null,
  title: over.title ?? "Test market",
  valuation: over.valuation ?? {
    price: null,
    priceSource: null,
    status: null,
    currentValueUsdc: null,
    currentValueUsdcBase: null,
    claimedPayoutUsdc: null,
  },
});

const mkt = (over: Partial<Market> & Pick<Market, "marketId">): Market => ({
  marketId: over.marketId,
  title: over.title ?? "Test market",
  category: over.category ?? "",
  phase: over.phase ?? "primary",
  status: over.status ?? over.phase ?? "primary",
  resolved: over.resolved ?? false,
  endTime: over.endTime ?? null,
  resolutionTime: over.resolutionTime ?? null,
  primaryPhaseEndTime: over.primaryPhaseEndTime ?? null,
  yesPrice: over.yesPrice ?? null,
  noPrice: over.noPrice ?? null,
  primaryYesPrice: over.primaryYesPrice ?? null,
  primaryNoPrice: over.primaryNoPrice ?? null,
});

describe("mark source labels (from bookMark only)", () => {
  it("labels Panta valuation / Indicative / Settlement / Validated spot / Unavailable", () => {
    const complete = pos({
      marketId: "a",
      valuation: {
        price: "0.5",
        priceSource: "primary_curve",
        status: "complete",
        currentValueUsdc: "5",
        currentValueUsdcBase: "5000000",
        claimedPayoutUsdc: null,
      },
      sharesNum: 10,
    });
    const px = marketProbability(mkt({ marketId: "a", yesPrice: "0.5", noPrice: "0.5", phase: "primary" }));
    const row = enrichPosition(complete, px, mkt({ marketId: "a", phase: "primary" }), NOW);
    expect(row.markSourceLabel).toBe("Panta valuation");
    expect(row.validMark).toBe(5);

    const indicative = pos({
      marketId: "b",
      phase: "secondary",
      valuation: {
        price: "0.5",
        priceSource: "secondary_last_trade",
        status: "indicative",
        currentValueUsdc: "5",
        currentValueUsdcBase: "5000000",
        claimedPayoutUsdc: null,
      },
      sharesNum: 10,
    });
    // Secondary YES/NO are not a probability pair; indicative still accepted once prices load.
    const pxOk = marketProbability(mkt({ marketId: "b", yesPrice: "0.5", noPrice: "0.5", phase: "secondary" }));
    expect(pxOk.yes).toBeNull();
    expect(enrichPosition(indicative, pxOk, mkt({ marketId: "b", phase: "secondary" }), NOW).markSourceLabel).toBe(
      "Indicative",
    );

    const winner = pos({
      marketId: "c",
      phase: "resolved",
      side: "yes",
      outcome: "yes",
      sharesNum: 7,
      shares: "7",
    });
    const settled = enrichPosition(winner, null, mkt({ marketId: "c", phase: "resolved", resolved: true }), NOW);
    expect(settled.markSourceLabel).toBe("Settlement");
    expect(settled.validMark).toBe(7);

    const spot = pos({ marketId: "d", phase: "primary", sharesNum: 4, shares: "4", side: "yes" });
    const spotPx = marketProbability(mkt({ marketId: "d", yesPrice: "0.6", noPrice: "0.4", phase: "primary" }));
    expect(enrichPosition(spot, spotPx, mkt({ marketId: "d", phase: "primary" }), NOW).markSourceLabel).toBe(
      "Validated spot",
    );

    const bad = enrichPosition(
      pos({ marketId: "e", phase: "primary" }),
      marketProbability(mkt({ marketId: "e", yesPrice: "0.9", noPrice: "0.9", phase: "secondary" })),
      mkt({ marketId: "e", phase: "secondary", yesPrice: "0.9", noPrice: "0.9" }),
      NOW,
    );
    expect(bad.markSourceLabel).toBe("Unavailable");
    expect(bad.validMark).toBeNull();
  });
});

describe("lifecycle from authoritative market (never from prices alone)", () => {
  it("uses market cache phase; does not infer secondary from price fields", () => {
    // Position still says primary, but authoritative market is secondary.
    const p = pos({ marketId: "x", phase: "primary" });
    expect(positionLifecycle(p, mkt({ marketId: "x", phase: "secondary" }), NOW)).toBe("secondary");
    expect(positionLifecycle(p, mkt({ marketId: "x", phase: "resolved", resolved: true }), NOW)).toBe("resolved");
    expect(positionLifecycle(p, mkt({ marketId: "x", phase: "cancelled" }), NOW)).toBe("cancelled");
    expect(positionLifecycle(p, null, NOW)).toBe("primary"); // fall back to position
    // Secondary-looking prices must not flip lifecycle when market says primary.
    const priced = mkt({ marketId: "x", phase: "primary", yesPrice: "0.8", noPrice: "0.8", secondaryYesPrice: "1" as never });
    expect(positionLifecycle(p, priced, NOW)).toBe("primary");
  });
});

describe("resolution countdown", () => {
  it("classes: countdown / resolved / awaiting / unknown — never invents times", () => {
    expect(formatResolutionCountdown(90 * 60)).toBe("1h 30m");
    expect(formatResolutionCountdown(2 * 86_400 + 3 * 3600)).toBe("2d 3h");
    expect(formatResolutionCountdown(45 * 60)).toBe("45m");

    const open = mkt({ marketId: "r", phase: "primary", resolutionTime: NOW_SEC + 3 * 3600 });
    expect(resolutionIntel(open, "primary", NOW)).toMatchObject({ kind: "countdown", label: "3h" });

    const day = mkt({ marketId: "r", phase: "secondary", endTime: NOW_SEC + 2 * 86_400 + 5 * 3600 });
    expect(resolutionIntel(day, "secondary", NOW).label).toBe("2d 5h");

    expect(resolutionIntel(mkt({ marketId: "r", phase: "resolved", resolved: true }), "resolved", NOW)).toEqual({
      kind: "resolved",
      label: "Resolved",
      totalSec: null,
    });

    const ended = mkt({ marketId: "r", phase: "secondary", endTime: NOW_SEC - 60 });
    expect(resolutionIntel(ended, "secondary", NOW)).toEqual({
      kind: "awaiting",
      label: "Event ended · awaiting resolution",
      totalSec: 0,
    });

    expect(resolutionIntel(mkt({ marketId: "r", phase: "primary" }), "primary", NOW)).toEqual({
      kind: "unknown",
      label: "Unknown",
      totalSec: null,
    });
  });
});

describe("claim readiness", () => {
  it("Claimable | Claimed | Not yet claimable | Resolution pending | Unavailable", () => {
    expect(
      claimReadinessWithResolution(pos({ marketId: "c", claimable: true }), "resolved", {
        kind: "resolved",
        label: "Resolved",
        totalSec: null,
      }),
    ).toEqual({ status: "claimable", label: "Claimable" });
    expect(
      claimReadinessWithResolution(pos({ marketId: "c", claimed: true, claimable: false }), "resolved", {
        kind: "resolved",
        label: "Resolved",
        totalSec: null,
      }),
    ).toEqual({ status: "claimed", label: "Claimed" });
    expect(
      claimReadinessWithResolution(pos({ marketId: "c" }), "primary", {
        kind: "countdown",
        label: "3h",
        totalSec: 10800,
      }),
    ).toEqual({ status: "not_yet", label: "Not yet claimable" });
    expect(
      claimReadinessWithResolution(pos({ marketId: "c", phase: "secondary" }), "secondary", {
        kind: "awaiting",
        label: "Event ended · awaiting resolution",
        totalSec: 0,
      }),
    ).toEqual({ status: "resolution_pending", label: "Resolution pending" });
    expect(
      claimReadinessWithResolution(pos({ marketId: "c", phase: "cancelled" }), "cancelled", {
        kind: "unknown",
        label: "Unknown",
        totalSec: null,
      }),
    ).toEqual({ status: "unavailable", label: "Unavailable" });
  });
});

describe("resolved winner / loser marks", () => {
  it("winner → settlement shares×1; loser → 0; claimed → unavailable; unknown outcome → unavailable", () => {
    const win = enrichPosition(
      pos({ marketId: "w", phase: "resolved", side: "yes", outcome: "yes", sharesNum: 3, shares: "3" }),
      null,
      mkt({ marketId: "w", phase: "resolved", resolved: true }),
      NOW,
    );
    expect(win.validMark).toBe(3);
    expect(win.markSourceLabel).toBe("Settlement");

    const lose = enrichPosition(
      pos({ marketId: "w", phase: "resolved", side: "no", outcome: "yes", sharesNum: 3, shares: "3" }),
      null,
      mkt({ marketId: "w", phase: "resolved", resolved: true }),
      NOW,
    );
    expect(lose.validMark).toBe(0);
    expect(lose.markSourceLabel).toBe("Settlement");

    const claimed = enrichPosition(
      pos({ marketId: "w", phase: "resolved", side: "yes", outcome: "yes", claimed: true, sharesNum: 3 }),
      null,
      mkt({ marketId: "w", phase: "resolved", resolved: true }),
      NOW,
    );
    expect(claimed.validMark).toBeNull();
    expect(claimed.claim.label).toBe("Claimed");

    const unknown = enrichPosition(
      pos({ marketId: "w", phase: "resolved", side: "yes", outcome: null, sharesNum: 3 }),
      null,
      mkt({ marketId: "w", phase: "resolved", resolved: true }),
      NOW,
    );
    expect(unknown.validMark).toBeNull();
  });
});

describe("portfolio aggregation", () => {
  const markets = {
    a: mkt({ marketId: "a", phase: "primary", title: "Alpha", yesPrice: "0.5", noPrice: "0.5", resolutionTime: NOW_SEC + 3600 }),
    b: mkt({ marketId: "b", phase: "secondary", title: "Beta", yesPrice: "0.5", noPrice: "0.5", endTime: NOW_SEC + 86_400 }),
    c: mkt({ marketId: "c", phase: "resolved", title: "Gamma", resolved: true }),
    d: mkt({ marketId: "d", phase: "secondary", title: "Delta", yesPrice: "1", noPrice: "1" }), // inconsistent → no mark
  };
  const prices = Object.fromEntries(Object.entries(markets).map(([id, m]) => [id, marketProbability(m)]));

  const rows = () =>
    enrichPositions(
      [
        pos({
          marketId: "a",
          side: "yes",
          shares: "10",
          sharesNum: 10,
          phase: "primary",
          title: "Alpha",
          valuation: {
            price: "0.5",
            priceSource: "primary_curve",
            status: "complete",
            currentValueUsdc: "5",
            currentValueUsdcBase: "5000000",
            claimedPayoutUsdc: null,
          },
        }),
        pos({
          marketId: "b",
          side: "no",
          shares: "20",
          sharesNum: 20,
          phase: "secondary",
          title: "Beta",
          valuation: {
            price: "0.5",
            priceSource: "secondary_last_trade",
            status: "complete",
            currentValueUsdc: "10",
            currentValueUsdcBase: "10000000",
            claimedPayoutUsdc: null,
          },
        }),
        pos({
          marketId: "c",
          side: "yes",
          shares: "4",
          sharesNum: 4,
          phase: "resolved",
          outcome: "yes",
          claimable: true,
          title: "Gamma",
        }),
        pos({ marketId: "d", side: "yes", shares: "8", sharesNum: 8, phase: "secondary", title: "Delta" }),
      ],
      prices,
      markets,
      NOW,
    );

  it("sums only valid marks; reports unavailable count; never treats null as zero", () => {
    const intel = portfolioIntel(rows());
    expect(intel.positionCount).toBe(4);
    // 5 + 10 + 4 (winner settlement) = 19; Delta unavailable
    expect(intel.totalValidMarked).toBe(19);
    expect(intel.validMarkCount).toBe(3);
    expect(intel.unavailableMarkCount).toBe(1);
    expect(intel.hasPartialMarks).toBe(true);
    expect(intel.noValidMarks).toBe(false);
  });

  it("YES vs NO exposure from valid marks only", () => {
    const intel = portfolioIntel(rows());
    expect(intel.yesExposure).toBe(5 + 4); // Alpha + Gamma
    expect(intel.noExposure).toBe(10); // Beta
  });

  it("largest position + percent of total valid", () => {
    const intel = portfolioIntel(rows());
    expect(intel.largest).toMatchObject({
      marketId: "b",
      title: "Beta",
      side: "no",
      markedValue: 10,
      percentOfValid: expect.closeTo((10 / 19) * 100, 5),
    });
  });

  it("lifecycle counts: claimable / active / secondary / resolved", () => {
    const intel = portfolioIntel(rows());
    expect(intel.claimableCount).toBe(1);
    expect(intel.activeCount).toBe(3); // a primary, b secondary, d secondary (even if mark unavailable)
    expect(intel.secondaryCount).toBe(2);
    expect(intel.resolvedCount).toBe(1);
  });

  it("zero valid marks → largest null + exposure-unavailable copy", () => {
    const onlyBad = enrichPositions(
      [pos({ marketId: "d", phase: "secondary" })],
      { d: marketProbability(markets.d) },
      { d: markets.d },
      NOW,
    );
    const intel = portfolioIntel(onlyBad);
    expect(intel.noValidMarks).toBe(true);
    expect(intel.marksPending).toBe(false);
    expect(intel.pendingMarkCount).toBe(0);
    expect(intel.unavailableMarkCount).toBe(1);
    expect(intel.largest).toBeNull();
    expect(intel.totalValidMarked).toBe(0);
    expect(LARGEST_UNAVAILABLE_NOTE).toMatch(/valid marks required/);
  });

  it("pending_prices while mark inputs load → marksPending (not unavailable)", () => {
    const pending = enrichPositions(
      [pos({ marketId: "a", side: "yes", shares: "10", sharesNum: 10, phase: "primary", title: "Alpha" })],
      {},
      {},
      NOW,
    );
    expect(pending[0].mark).toMatchObject({ value: null, reason: "pending_prices" });
    const intel = portfolioIntel(pending);
    expect(intel.marksPending).toBe(true);
    expect(intel.pendingMarkCount).toBe(1);
    expect(intel.unavailableMarkCount).toBe(0);
    expect(intel.noValidMarks).toBe(true);
    expect(intel.largest).toBeNull();
    expect(MARKS_LOADING_NOTE).toMatch(/Loading marks/);
  });

  it("empty book", () => {
    const intel = portfolioIntel([]);
    expect(intel).toMatchObject({
      positionCount: 0,
      totalValidMarked: 0,
      claimableCount: 0,
      largest: null,
      noValidMarks: true,
      marksPending: false,
      pendingMarkCount: 0,
    });
  });
});

describe("freshness + no P&L fabrication", () => {
  it("labels from query state", () => {
    expect(dataFreshness({ updatedAtMs: NOW, isFetching: false, isError: false, hasData: true, nowMs: NOW + 1000 }).label).toBe(
      "Updated just now",
    );
    expect(dataFreshness({ updatedAtMs: NOW, isFetching: false, isError: false, hasData: true, nowMs: NOW + 12_000 }).label).toBe(
      "Updated 12s ago",
    );
    expect(dataFreshness({ updatedAtMs: NOW, isFetching: true, isError: false, hasData: true, nowMs: NOW }).kind).toBe(
      "refreshing",
    );
    expect(dataFreshness({ updatedAtMs: null, isFetching: false, isError: true, hasData: false, nowMs: NOW }).label).toBe(
      "Refresh failed",
    );
  });
  it("explicit P&L-unavailable note; module never mentions average entry / ROI / cost basis as computed", async () => {
    expect(PNL_UNAVAILABLE_NOTE).toMatch(/P&L unavailable/);
    expect(PNL_UNAVAILABLE_NOTE).toMatch(/cost basis/);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/panta/position-intel.ts", "utf8");
    expect(src).not.toMatch(/\b(roi|averageEntry|avgEntry|costBasis|profit)\b/i);
    expect(src).toMatch(/invented P&L/);
  });
});
