/**
 * Phase 2 acceptance A–K (deterministic data/signal layer).
 */
import { describe, expect, it } from "vitest";
import { buildTemplateBrief } from "@/lib/brief";
import { checkLlmBrief, evidenceNumbers } from "@/lib/brief-guard";
import type { Market, Trade } from "@/lib/panta/domain";
import { marketProbability, secondaryLastObservedPrices } from "@/lib/panta/prices";
import {
  filterSecondaryPrints,
  secondaryFlow,
  secondaryTapeQuality,
} from "@/lib/panta/secondary-intel";
import { computeMarketSignals } from "@/lib/panta/signals";
import { bookMark, pantaValuation } from "@/lib/panta/position-value";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const NOW_SEC = Math.floor(NOW / 1000);

const secMkt = (over: Partial<Market> = {}): Market => ({
  marketId: over.marketId ?? "secMktAK1111111111111111111111111111111111",
  title: over.title ?? "France vs Belgium",
  category: "sports",
  phase: "secondary",
  status: "secondary",
  yesPrice: "0.506",
  noPrice: "0.494",
  secondaryYesPrice: "506406474",
  secondaryNoPrice: "493593526",
  endTime: NOW_SEC + 3600,
  resolutionTime: NOW_SEC + 3600,
  volumeUsdc: "100",
  ...over,
});

const priMkt = (over: Partial<Market> = {}): Market =>
  secMkt({
    phase: "primary",
    status: "primary",
    yesPrice: "0.60",
    noPrice: "0.40",
    primaryYesPrice: "0.60",
    primaryNoPrice: "0.40",
    secondaryYesPrice: null,
    secondaryNoPrice: null,
    ...over,
  });

const tr = (over: Partial<Trade> & { i: number }): Trade => ({
  id: String(over.i),
  marketId: "m",
  wallet: over.wallet ?? `w${over.i % 4}`,
  signature: `sig${over.i}`,
  blockTime: NOW_SEC - 600 + over.i * 10,
  isPrimary: over.isPrimary ?? false,
  kind: "buy",
  side: over.side ?? "yes",
  shares: "shares" in over ? over.shares ?? null : 10,
  amountUsdc: over.amountUsdc ?? null,
});

describe("Phase2 A–K acceptance", () => {
  it("A secondary 0.506/0.494 accepted, no inconsistent warning, no probability framing", () => {
    const m = secMkt();
    const px = secondaryLastObservedPrices(m);
    expect(px.yes).toBeCloseTo(0.506406474);
    expect(px.no).toBeCloseTo(0.493593526);
    expect(px.yesLabel).toBe("Last observed YES secondary price");
    expect(px.noLabel).toBe("Last observed NO secondary price");
    const prob = marketProbability(m);
    expect(prob.reason).toBe("not_applicable");
    expect(prob.yes).toBeNull();
    const s = computeMarketSignals(m, [], NOW);
    expect(s.probability.reason).toBe("not_applicable");
    expect(s.riskFlags.some((f) => f.id === "inconsistent_prices")).toBe(false);
    expect(s.dataQuality.reasons.some((r) => /inconsistent/i.test(r))).toBe(false);
    expect(s.secondaryLastObserved?.yes).toBeCloseTo(0.506406474);
    const brief = buildTemplateBrief(m, s, "desk");
    expect(brief).toMatch(/Last observed YES secondary price/i);
    expect(brief).not.toMatch(/secondary probability/i);
    expect(brief).not.toMatch(/inconsistent/i);
    expect(brief).not.toMatch(/\b\d+(\.\d+)?%/); // no probability % framing of secondary prices
  });

  it("B secondary 0.70/0.40 valid, no sum failure, no normalization", () => {
    const m = secMkt({
      secondaryYesPrice: "0.70",
      secondaryNoPrice: "0.40",
      yesPrice: "0.70",
      noPrice: "0.40",
    });
    const px = secondaryLastObservedPrices(m);
    expect(px.yes).toBeCloseTo(0.7);
    expect(px.no).toBeCloseTo(0.4);
    expect(px.yes! + px.no!).toBeCloseTo(1.1);
    const s = computeMarketSignals(m, [], NOW);
    expect(s.probability.reason).toBe("not_applicable");
    expect(s.riskFlags.some((f) => f.id === "inconsistent_prices")).toBe(false);
    expect(s.secondaryLastObserved?.yes).toBe(0.7);
    expect(s.secondaryLastObserved?.no).toBe(0.4);
    // Never normalized to sum 1
    expect(s.secondaryLastObserved!.yes! + s.secondaryLastObserved!.no!).toBeCloseTo(1.1);
  });

  it("C 11 primary + 0 secondary: count 0, flow unavailable, primary excluded", () => {
    const primary = Array.from({ length: 11 }, (_, i) =>
      tr({ i, isPrimary: true, side: i % 2 === 0 ? "yes" : "no", shares: 50 }),
    );
    const s = computeMarketSignals(secMkt(), primary, NOW);
    expect(s.tape.count).toBe(11);
    expect(s.tape.primaryPrints).toBe(11);
    expect(s.tape.secondaryPrints).toBe(0);
    expect(s.flow.yesFlowShare).toBeNull();
    expect(s.flow.imbalance).toBeNull();
    expect(s.flow.basis).toBeNull();
    expect(s.headline).toMatch(/No observed secondary prints — secondary flow unavailable/i);
    expect(s.headline).not.toMatch(/flow favors|YES \d+%/i);
    expect(s.tape.printConcentration.wallets).toBe(0);
    expect(s.volume.recentShares).toBeNull();
    const filt = filterSecondaryPrints(primary);
    expect(filt).toHaveLength(0);
    expect(secondaryFlow(filt, NOW).printCount).toBe(0);
  });

  it("D 11 primary + 4 secondary: flow uses exactly the 4", () => {
    const primary = Array.from({ length: 11 }, (_, i) =>
      tr({ i, isPrimary: true, side: "yes", shares: 100, wallet: "primaryW" }),
    );
    const secondary = [
      tr({ i: 100, isPrimary: false, side: "yes", shares: 10, wallet: "s1" }),
      tr({ i: 101, isPrimary: false, side: "yes", shares: 10, wallet: "s2" }),
      tr({ i: 102, isPrimary: false, side: "no", shares: 10, wallet: "s3" }),
      tr({ i: 103, isPrimary: false, side: "no", shares: 10, wallet: "s4" }),
    ];
    const tape = [...primary, ...secondary];
    const s = computeMarketSignals(secMkt(), tape, NOW);
    expect(s.tape.primaryPrints).toBe(11);
    expect(s.tape.secondaryPrints).toBe(4);
    expect(s.tape.yesPrints + s.tape.noPrints).toBe(4);
    expect(s.flow.basis).toBe("shares");
    expect(s.flow.yesFlowShare).toBeCloseTo(0.5);
    expect(s.flow.yesShares).toBeCloseTo(20);
    expect(s.flow.noShares).toBeCloseTo(20);
    expect(s.tape.printConcentration.wallets).toBe(4);
    expect(s.headline).toMatch(/Secondary tape:/);
    expect(s.headline).toMatch(/last 4 prints/);
  });

  it("E secondary rows with readable sizes: share-weighted", () => {
    const prints = [
      tr({ i: 0, isPrimary: false, side: "yes", shares: 30 }),
      tr({ i: 1, isPrimary: false, side: "no", shares: 10 }),
    ];
    const s = computeMarketSignals(secMkt(), prints, NOW);
    expect(s.flow.basis).toBe("shares");
    expect(s.flow.yesFlowShare).toBeCloseTo(0.75);
    expect(secondaryFlow(prints, NOW).basis).toBe("shares");
  });

  it("F secondary rows without complete sizes: print-weighted (existing documented fallback)", () => {
    const prints = [
      tr({ i: 0, isPrimary: false, side: "yes", shares: 30 }),
      tr({ i: 1, isPrimary: false, side: "no", shares: null }),
      tr({ i: 2, isPrimary: false, side: "no", shares: null }),
    ];
    const s = computeMarketSignals(secMkt(), prints, NOW);
    expect(s.flow.basis).toBe("prints");
    expect(s.flow.yesFlowShare).toBeCloseTo(1 / 3);
    expect(s.dataQuality.reasons.some((r) => /print-weighted/i.test(r))).toBe(true);
  });

  it("G partial state preserved after filtering", () => {
    const tape = [
      ...Array.from({ length: 5 }, (_, i) => tr({ i, isPrimary: true })),
      tr({ i: 10, isPrimary: false, side: "yes" }),
      tr({ i: 11, isPrimary: false, side: "no" }),
    ];
    const completeness = { complete: false as const, returned: 20, parsed: 7, dropped: 13 };
    const s = computeMarketSignals(secMkt(), tape, NOW, { tapeCompleteness: completeness });
    expect(s.tape.completeness).toEqual(completeness);
    expect(s.tape.secondaryPrints).toBe(2);
    expect(s.dataQuality.reasons.some((r) => /Partial tape/i.test(r))).toBe(true);
    const q = secondaryTapeQuality({
      isError: false,
      isPending: false,
      hasData: true,
      completeness,
      secondaryPrintCount: 2,
    });
    expect(q.kind).toBe("partial");
    if (q.kind === "partial") {
      expect(q.returned).toBe(20);
      expect(q.dropped).toBe(13);
    }
  });

  it("H tape failure distinct from zero activity", () => {
    const failed = secondaryTapeQuality({
      isError: true,
      isPending: false,
      hasData: false,
      completeness: null,
      secondaryPrintCount: 0,
    });
    const empty = secondaryTapeQuality({
      isError: false,
      isPending: false,
      hasData: true,
      completeness: { complete: true, returned: 11, parsed: 11, dropped: 0 },
      secondaryPrintCount: 0,
    });
    expect(failed.kind).toBe("failed");
    if (failed.kind === "failed") expect(failed.label).toMatch(/Secondary tape request failed/);
    expect(empty.kind).toBe("empty");
    expect(failed.kind).not.toBe(empty.kind);
  });

  it("I secondary AI/template: no primary probability or bonding-curve wording, secondary prices allowed as evidence numbers", () => {
    const m = secMkt();
    const s = computeMarketSignals(m, [tr({ i: 0 }), tr({ i: 1, side: "no" })], NOW);
    const narrative = buildTemplateBrief(m, s, "desk");
    expect(narrative).toMatch(/Last observed YES secondary price/i);
    expect(narrative).toMatch(/0\.506/);
    expect(narrative).not.toMatch(/bonding-curve/i);
    expect(narrative).not.toMatch(/Market probability: YES/i);
    expect(narrative).toMatch(/secondary CLOB execution is not currently routed/);
    const evidence = evidenceNumbers(s, [narrative], []);
    expect(evidence.strict.has("0.506406") || evidence.strict.has("0.506")).toBe(true);
    const ok = checkLlmBrief(narrative, {
      probabilityAvailable: false,
      evidence,
      secondaryPhase: true,
    });
    expect(ok).toEqual({ ok: true });
    const bad = checkLlmBrief(
      narrative.replace("### Interpretation\n", "### Interpretation\nYES looks 70% likely. "),
      { probabilityAvailable: false, evidence, secondaryPhase: true },
    );
    expect(bad.ok).toBe(false);
  });

  it("J primary complementary semantics unchanged", () => {
    const m = priMkt();
    const prob = marketProbability(m);
    expect(prob.yes).toBeCloseTo(0.6);
    expect(prob.no).toBeCloseTo(0.4);
    expect(prob.reason).toBeNull();
    const tape = Array.from({ length: 6 }, (_, i) =>
      tr({ i, isPrimary: true, side: i < 4 ? "yes" : "no", shares: 10 }),
    );
    const s = computeMarketSignals(m, tape, NOW);
    expect(s.probability.yes).toBeCloseTo(0.6);
    expect(s.secondaryLastObserved).toBeNull();
    expect(s.tape.count).toBe(6);
    expect(s.flow.yesFlowShare).toBeCloseTo(4 / 6);
    expect(s.execution.lines.some((l) => /bonding-curve/i.test(l))).toBe(true);
    expect(s.execution.lines.some((l) => /quote required/i.test(l))).toBe(true);
    const badPair = marketProbability(priMkt({ yesPrice: "0.70", noPrice: "0.40" }));
    expect(badPair.reason).toBe("inconsistent_prices");
  });

  it("K resolved/cancelled settlement unchanged", () => {
    const resolved = computeMarketSignals(
      secMkt({ phase: "resolved", status: "resolved", resolved: true, yesPrice: "1", noPrice: "0" }),
      [tr({ i: 0, isPrimary: true })],
      NOW,
    );
    expect(resolved.resolved).toBe(true);
    expect(resolved.probability.source).toBe("settled");
    expect(resolved.execution.lines.some((l) => /Resolved/i.test(l))).toBe(true);

    const cancelled = computeMarketSignals(
      priMkt({ phase: "cancelled", status: "cancelled", yesPrice: "0.5", noPrice: "0.5" }),
      [],
      NOW,
    );
    expect(cancelled.execution.lines.some((l) => /Cancelled/i.test(l))).toBe(true);
  });
});

describe("indicative secondary marks (position-value)", () => {
  it("indicative secondary marks pass arithmetic; null prices never become 0", () => {
    const pos = {
      marketId: "m",
      category: null,
      side: "yes",
      shares: "10",
      sharesNum: 10,
      phase: "secondary",
      claimable: false,
      claimed: false,
      outcome: null,
      title: null,
      valuation: {
        status: "indicative",
        currentValueUsdc: "5.06",
        currentValueUsdcBase: "5060000",
        price: "0.506",
        priceSource: "secondary_last",
        claimedPayoutUsdc: null,
      },
    };
    // Secondary: probability not applicable; prices object is still "loaded".
    const pxLoaded = marketProbability({
      phase: "secondary",
      yesPrice: "0.506",
      noPrice: "0.494",
      secondaryYesPrice: "506406474",
      secondaryNoPrice: "493593526",
    });
    expect(pxLoaded.reason).toBe("not_applicable");
    const mark = bookMark(pos as never, pxLoaded);
    expect(mark.value).toBeCloseTo(5.06);
    expect(mark.value).not.toBe(0);
    if (mark.value == null) throw new Error("expected marked value");
    expect(mark.source).toBe("panta");
    expect(mark.indicative).toBe(true);

    const noPrice = {
      ...pos,
      valuation: {
        status: "indicative",
        currentValueUsdc: "5",
        currentValueUsdcBase: null,
        price: null,
        priceSource: "x",
        claimedPayoutUsdc: null,
      },
    };
    const pv = pantaValuation(noPrice as never, pxLoaded);
    expect(typeof pv).toBe("string");

    const nullMark = bookMark(
      { ...pos, valuation: undefined } as never,
      marketProbability({ phase: "secondary", yesPrice: null, noPrice: null }),
    );
    expect(nullMark.value).toBeNull();
    expect(nullMark.value).not.toBe(0);
  });
});
