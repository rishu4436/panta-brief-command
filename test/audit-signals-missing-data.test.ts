/**
 * Audit (Oct 2026 test pass): missing-data behaviour of the signal engine.
 * Verifies existing behaviour only; see panta-brief-command-test-report.md.
 */
import { describe, expect, it } from "vitest";
import type { Market, Trade } from "@/lib/panta/domain";
import { computeMarketSignals } from "@/lib/panta/signals";

const NOW = Date.UTC(2026, 9, 3, 3, 0, 0);
const nowSec = NOW / 1000;
const market = (over: Partial<Market> = {}): Market => ({
  marketId: "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB",
  title: "Audit market",
  category: "audit",
  phase: "secondary",
  yesPrice: "0.55",
  noPrice: "0.45",
  resolutionTime: nowSec + 10 * 86_400,
  ...over,
});
const t = (i: number, over: Partial<Trade> = {}): Trade => ({
  id: String(i),
  marketId: "m",
  wallet: `w${i % 3}`,
  signature: `s${i}`,
  blockTime: nowSec - 3600 + i * 60,
  isPrimary: false,
  kind: "buy",
  side: i % 2 ? "no" : "yes",
  shares: 10 + i,
  amountUsdc: null,
  ...over,
});
const tape = (n: number, f: (i: number) => Partial<Trade> = () => ({})) =>
  Array.from({ length: n }, (_, i) => t(i, f(i)));

describe("audit: flow basis", () => {
  it("share-weighted only when every sided print has shares", () => {
    const s = computeMarketSignals(market(), tape(10), NOW);
    expect(s.flow.basis).toBe("shares");
  });
  it("falls back to print-weighted when any sided print lacks shares", () => {
    const s = computeMarketSignals(market(), tape(10, (i) => (i === 3 ? { shares: null } : {})), NOW);
    expect(s.flow.basis).toBe("prints");
    expect(s.flow.yesShares).toBeNull();
    expect(s.flow.noShares).toBeNull();
    expect(s.flow.yesFlowShare).toBeCloseTo(0.5);
    expect(s.dataQuality.reasons.join(" ")).toMatch(/print-weighted/);
  });
});

describe("audit: concentration is labelled separately", () => {
  it("print and size concentration are distinct values", () => {
    const tp = tape(10, (i) => ({ wallet: i < 6 ? "big" : `w${i}`, shares: i < 6 ? 1 : 100 }));
    const s = computeMarketSignals(market(), tp, NOW);
    expect(s.tape.printConcentration.topWalletShareOfPrints).toBeCloseTo(0.6);
    expect(s.tape.sizeConcentration.topWalletShareOfSize).toBeCloseTo(100 / 406, 3);
  });
  it("size concentration is null with a reason when one wallet print lacks a size", () => {
    const s = computeMarketSignals(market(), tape(10, (i) => (i === 0 ? { shares: null } : {})), NOW);
    expect(s.tape.sizeConcentration.topWalletShareOfSize).toBeNull();
    expect(s.tape.sizeConcentration.reason).toBeTruthy();
  });
  it("no wallet attribution at all: both concentrations unknown, not 0", () => {
    const s = computeMarketSignals(market(), tape(10, () => ({ wallet: null })), NOW);
    expect(s.tape.printConcentration.topWalletShareOfPrints).toBeNull();
    expect(s.tape.printConcentration.printsWithoutWallet).toBe(10);
    expect(s.tape.sizeConcentration.topWalletShareOfSize).toBeNull();
  });
});

describe("audit: missing prices / timestamps stay null", () => {
  it("no prices → probability null, divergence null, no_price flag", () => {
    const s = computeMarketSignals(
      market({ yesPrice: null, noPrice: null, primaryYesPrice: null, primaryNoPrice: null }),
      tape(10),
      NOW,
    );
    expect(s.probability.yes).toBeNull();
    expect(s.probability.no).toBeNull();
    expect(s.divergence.gapPts).toBeNull();
    expect(s.riskFlags.map((f) => f.id)).toContain("no_price");
    expect(s.dataQuality.grade).toBe("low");
  });
  it("no timestamps → window and last-print age null (not 0)", () => {
    const s = computeMarketSignals(market(), tape(10, () => ({ blockTime: null })), NOW);
    expect(s.tape.windowMinutes).toBeNull();
    expect(s.tape.lastPrintAgeMinutes).toBeNull();
  });
  it("probabilityChange is always null with a reason", () => {
    const s = computeMarketSignals(market(), tape(10), NOW);
    expect(s.probabilityChange.value).toBeNull();
    expect(s.probabilityChange.reason).toMatch(/no per-trade price/);
  });
});

describe("audit: known gaps (documented, not fixed)", () => {
  it("GAP P2: recentShares is a partial sum when some prints lack shares (not null)", () => {
    const s = computeMarketSignals(market(), tape(4, (i) => (i === 0 ? { shares: null } : {})), NOW);
    // Prints 1..3 carry 11+12+13 = 36 shares; print 0 is unknown but the sum is still reported.
    expect(s.volume.recentShares).toBe(36);
  });
});

describe("audit: incoherent spot prices (fixed, was GAP P1)", () => {
  it("YES 1 + NO 1 (seen live) → probability unavailable, flagged, no divergence", () => {
    const s = computeMarketSignals(market({ yesPrice: "1", noPrice: "1" }), tape(10), NOW);
    expect(s.probability.yes).toBeNull();
    expect(s.probability.no).toBeNull();
    expect(s.probability.source).toBe("unavailable");
    expect(s.probability.reason).toBe("inconsistent_prices");
    expect(s.probability.raw.yesPrice).toBe("1");
    expect(s.riskFlags.map((f) => f.id)).toContain("inconsistent_prices");
    expect(s.divergence.gapPts).toBeNull();
  });
});
