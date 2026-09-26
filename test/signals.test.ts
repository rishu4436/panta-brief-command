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
