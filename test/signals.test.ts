import { describe, expect, it } from "vitest";
import type { Market, Trade } from "@/lib/panta/domain";
import { computeMarketSignals } from "@/lib/panta/signals";

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const nowSec = NOW / 1000;

const market = (over: Partial<Market> = {}): Market => ({
  marketId: "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB",
  title: "Will it rain?",
  category: "weather",
  phase: "secondary",
  status: "secondary_active",
  yesPrice: "0.60",
  noPrice: "0.40",
  resolutionTime: nowSec + 86_400,
  ...over,
});

const trade = (side: "yes" | "no", i: number, shares = 10): Trade => ({
  id: String(i),
  marketId: "m",
  wallet: `wallet${i % 5}`,
  signature: `sig${i}`,
  blockTime: nowSec - 600 + i * 10,
  isPrimary: false,
  kind: "buy",
  side,
  shares,
  amountUsdc: null,
});

describe("computeMarketSignals", () => {
  it("YES 60% / NO 40% gives a YES lean", () => {
    const tape = [
      ...Array.from({ length: 6 }, (_, i) => trade("yes", i)),
      ...Array.from({ length: 4 }, (_, i) => trade("no", i + 6)),
    ];
    const s = computeMarketSignals(market(), tape, NOW);
    expect(s.probability.yes).toBeCloseTo(0.6);
    expect(s.probability.no).toBeCloseTo(0.4);
    expect(s.probability.source).toBe("spot");
    expect(s.flow.yesFlowShare).toBeCloseTo(0.6);
    expect(s.flow.imbalance).toBeGreaterThan(0);
    expect(s.tape.yesPrints).toBe(6);
    expect(s.tape.noPrints).toBe(4);
    expect(s.divergence.direction).toBe("aligned");
    expect(s.resolved).toBe(false);
  });

  it("empty tape gives low data quality and no invented flow", () => {
    const s = computeMarketSignals(market(), [], NOW);
    expect(s.dataQuality.grade).toBe("low");
    expect(s.tape.count).toBe(0);
    expect(s.flow.yesFlowShare).toBeNull();
    expect(s.probabilityChange.value).toBeNull();
    expect(s.divergence.gapPts).toBeNull();
  });

  it("resolved market reports the settlement and skips divergence", () => {
    const s = computeMarketSignals(
      market({ phase: "resolved", resolved: true, yesPrice: "1", noPrice: "0", resolutionTime: nowSec - 3600 }),
      [trade("yes", 1), trade("no", 2), trade("yes", 3)],
      NOW,
    );
    expect(s.resolved).toBe(true);
    expect(s.outcome).toBe("yes");
    expect(s.probability.source).toBe("settled");
    expect(s.divergence.direction).toBeNull();
    expect(s.execution.primaryOpen).toBe(false);
    expect(s.riskFlags.some((f) => f.id.includes("resolved"))).toBe(true);
  });

  it("partial detail downgrades data quality", () => {
    const tape = Array.from({ length: 12 }, (_, i) => trade(i % 2 ? "yes" : "no", i));
    const full = computeMarketSignals(market(), tape, NOW);
    const partial = computeMarketSignals(market({ partial: true }), tape, NOW);
    const rank = { high: 2, medium: 1, low: 0 } as const;
    expect(rank[partial.dataQuality.grade]).toBeLessThanOrEqual(rank[full.dataQuality.grade]);
  });
});

describe("wallet concentration", () => {
  const t = (wallet: string | null, shares: number | null, amountUsdc: number | null, i: number): Trade => ({
    ...trade("yes", i),
    wallet,
    shares,
    amountUsdc,
  });

  it("print concentration counts prints, size concentration weighs shares", () => {
    // Whale: 1 print of 900 shares. Retail wallet A: 4 prints of 25 shares.
    const tape = [t("whale", 900, null, 0), ...[1, 2, 3, 4].map((i) => t("A", 25, null, i))];
    const s = computeMarketSignals(market(), tape, NOW);
    expect(s.tape.printConcentration).toEqual({ topWalletShareOfPrints: 0.8, wallets: 2, printsWithoutWallet: 0 });
    expect(s.tape.sizeConcentration).toEqual({ topWalletShareOfSize: 0.9, basis: "shares", reason: null });
    const ids = s.riskFlags.map((f) => f.id);
    expect(ids).toContain("concentrated_prints");
    expect(ids).toContain("concentrated_size");
    expect(s.riskFlags.find((f) => f.id === "concentrated_prints")!.label).toMatch(/top wallet made 80.0% of prints/);
  });

  it("falls back to USDC only when every wallet print has USDC", () => {
    const tape = [t("a", null, 30, 0), t("b", null, 10, 1)];
    const s = computeMarketSignals(market(), tape, NOW);
    expect(s.tape.sizeConcentration).toEqual({ topWalletShareOfSize: 0.75, basis: "usdc", reason: null });
  });

  it("is unknown (not guessed) when any print lacks a size", () => {
    const tape = [t("a", 30, null, 0), t("b", null, null, 1), t("a", 5, null, 2)];
    const s = computeMarketSignals(market(), tape, NOW);
    expect(s.tape.printConcentration.topWalletShareOfPrints).toBeCloseTo(0.6667, 3);
    expect(s.tape.sizeConcentration.topWalletShareOfSize).toBeNull();
    expect(s.tape.sizeConcentration.reason).toMatch(/size/);
    expect(s.riskFlags.map((f) => f.id)).not.toContain("concentrated_size");
  });

  it("excludes prints without a wallet and reports them", () => {
    const s = computeMarketSignals(market(), [t(null, 10, null, 0), t("a", 10, null, 1)], NOW);
    expect(s.tape.printConcentration).toEqual({ topWalletShareOfPrints: 1, wallets: 1, printsWithoutWallet: 1 });
  });

  it("empty tape: both unknown", () => {
    const s = computeMarketSignals(market(), [], NOW);
    expect(s.tape.printConcentration.topWalletShareOfPrints).toBeNull();
    expect(s.tape.sizeConcentration).toMatchObject({ topWalletShareOfSize: null, reason: "No prints in the tape window" });
  });
});
