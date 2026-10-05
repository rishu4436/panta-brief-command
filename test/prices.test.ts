/**
 * The single price layer (src/lib/panta/prices.ts). Cases include the two
 * incoherent secondary markets seen live on 3 Oct 2026.
 */
import { describe, expect, it } from "vitest";
import type { Market } from "@/lib/panta/domain";
import { impliedSide } from "@/lib/format";
import { checkPricePair, marketProbability, positionMark, PRICE_SUM_TOLERANCE } from "@/lib/panta/prices";
import { computeMarketSignals } from "@/lib/panta/signals";

const m = (over: Partial<Market> = {}): Market => ({
  marketId: "3Ry1mLYLtest",
  title: "Test market",
  category: "test",
  phase: "secondary",
  ...over,
});

describe("checkPricePair", () => {
  it("YES=1 / NO=1 (Dangote, live) is inconsistent", () => {
    expect(checkPricePair("1", "1")).toEqual({ ok: false, reason: "inconsistent_prices" });
  });
  it("YES=0.5 / NO=0.328 (HYPE, live) is inconsistent", () => {
    expect(checkPricePair("0.5", "0.328260245")).toEqual({ ok: false, reason: "inconsistent_prices" });
  });
  it("0.62 / 0.38 is valid", () => {
    expect(checkPricePair("0.62", "0.38")).toEqual({ ok: true, yes: 0.62, no: 0.38 });
  });
  it("tolerance is 0.02 inclusive", () => {
    expect(PRICE_SUM_TOLERANCE).toBe(0.02);
    expect(checkPricePair(0.61, 0.38).ok).toBe(true); // sum 0.99
    expect(checkPricePair(0.6, 0.37).ok).toBe(false); // sum 0.97
    expect(checkPricePair(0.65, 0.38).ok).toBe(false); // sum 1.03
  });
  it("out of range is inconsistent", () => {
    expect(checkPricePair("1.2", "-0.2")).toEqual({ ok: false, reason: "inconsistent_prices" });
    expect(checkPricePair("-0.1", "1.1")).toEqual({ ok: false, reason: "inconsistent_prices" });
    expect(checkPricePair("1.2", null)).toEqual({ ok: false, reason: "inconsistent_prices" });
    expect(checkPricePair("abc", "0.5")).toEqual({ ok: false, reason: "inconsistent_prices" });
  });
  it("missing and one-sided are distinct reasons", () => {
    expect(checkPricePair(null, undefined)).toEqual({ ok: false, reason: "missing_prices" });
    expect(checkPricePair("", "")).toEqual({ ok: false, reason: "missing_prices" });
    expect(checkPricePair("0.6", null)).toEqual({ ok: false, reason: "incomplete_prices" });
  });
  it("a genuine 0 / 1 is valid, not missing", () => {
    expect(checkPricePair("0", "1")).toEqual({ ok: true, yes: 0, no: 1 });
  });
});

describe("marketProbability", () => {
  it("Dangote live fields → unavailable, raw kept", () => {
    const p = marketProbability(
      m({
        yesPrice: "1",
        noPrice: "1",
        primaryYesPrice: "0.435722534",
        primaryNoPrice: "0.564277466",
        secondaryYesPrice: "1000000000",
        secondaryNoPrice: "1000000000",
      }),
    );
    expect(p).toMatchObject({ yes: null, no: null, source: "unavailable", reason: "not_applicable" });
    expect(p.raw).toMatchObject({ yesPrice: "1", noPrice: "1", secondaryYesPrice: "1000000000" });
  });
  it("HYPE live fields → not_applicable (no primary-curve substitute; not a defect)", () => {
    const p = marketProbability(
      m({ yesPrice: "0.5", noPrice: "0.328260245", primaryYesPrice: "0.671739755", primaryNoPrice: "0.328260245" }),
    );
    expect(p.source).toBe("unavailable");
    expect(p.reason).toBe("not_applicable");
  });
  it("complementary secondary YES/NO still not_applicable (independent last-trade, not a probability)", () => {
    expect(marketProbability(m({ yesPrice: "0.62", noPrice: "0.38" }))).toMatchObject({
      yes: null,
      no: null,
      source: "unavailable",
      reason: "not_applicable",
    });
  });
  it("valid primary spot unchanged", () => {
    expect(marketProbability(m({ phase: "primary", yesPrice: "0.62", noPrice: "0.38" }))).toMatchObject({
      yes: 0.62,
      no: 0.38,
      source: "spot",
    });
  });
  it("resolved market reads as settled", () => {
    expect(marketProbability(m({ phase: "resolved", resolved: true, yesPrice: "1", noPrice: "0" }))).toMatchObject({
      yes: 1,
      source: "settled",
    });
  });
  it("primary curve only for a primary market with no spot", () => {
    expect(
      marketProbability(m({ phase: "primary", yesPrice: null, noPrice: null, primaryYesPrice: "0.6", primaryNoPrice: "0.4" })),
    ).toMatchObject({ yes: 0.6, no: 0.4, source: "primary_curve" });
    // Secondary market with only the (frozen) curve price → unavailable, missing.
    expect(
      marketProbability(m({ phase: "secondary", yesPrice: null, noPrice: null, primaryYesPrice: "0.6", primaryNoPrice: "0.4" })),
    ).toMatchObject({ yes: null, source: "unavailable", reason: "not_applicable" });
    // Inconsistent spot is never replaced by the curve, even while primary.
    expect(
      marketProbability(m({ phase: "primary", yesPrice: "1", noPrice: "1", primaryYesPrice: "0.6", primaryNoPrice: "0.4" })),
    ).toMatchObject({ yes: null, reason: "inconsistent_prices" });
  });
  it("missing everything on secondary → not_applicable", () => {
    expect(marketProbability(m())).toMatchObject({ yes: null, no: null, source: "unavailable", reason: "not_applicable" });
  });
  it("missing everything on primary → missing_prices", () => {
    expect(marketProbability(m({ phase: "primary", status: "primary" }))).toMatchObject({
      yes: null,
      no: null,
      source: "unavailable",
      reason: "missing_prices",
    });
  });
});

describe("impliedSide (display consumers)", () => {
  it("never returns inconsistent prices for display", () => {
    expect(impliedSide(m({ yesPrice: "1", noPrice: "1" }))).toMatchObject({ yes: null, no: null, unavailable: "not_applicable" });
    // Secondary complementary pair is still not a probability for display.
    expect(impliedSide(m({ yesPrice: "0.62", noPrice: "0.38" }))).toMatchObject({ yes: null, no: null, unavailable: "not_applicable" });
    expect(impliedSide(m({ phase: "primary", yesPrice: "0.62", noPrice: "0.38" }))).toMatchObject({
      yes: "0.62",
      no: "0.38",
      unavailable: null,
    });
  });
});

describe("positionMark", () => {
  const bad = marketProbability(m({ phase: "primary", yesPrice: "1", noPrice: "1" }));
  const ok = marketProbability(m({ phase: "primary", yesPrice: "0.62", noPrice: "0.38" }));
  it("no mark when the probability is unavailable", () => {
    expect(positionMark(100, "yes", bad)).toEqual({ value: null, price: null, reason: "inconsistent_prices" });
    expect(positionMark(100, "no", marketProbability(m({ phase: "primary", status: "primary" })))).toMatchObject({ value: null, reason: "missing_prices" });
  });
  it("shares × validated side price", () => {
    expect(positionMark(100, "no", ok)).toEqual({ value: 38, price: 0.38, reason: null });
    expect(positionMark(0, "yes", ok)).toMatchObject({ value: 0, reason: null });
  });
  it("unknown side or shares → no mark", () => {
    expect(positionMark(100, null, ok).reason).toBe("unknown_side");
    expect(positionMark(null, "yes", ok).reason).toBe("unknown_shares");
  });
});

describe("signals use the price layer", () => {
  const NOW = Date.UTC(2026, 9, 3, 3, 0, 0);
  it("secondary independent prices → not_applicable, no inconsistent flag or quality cap", () => {
    const s = computeMarketSignals(
      m({
        yesPrice: "0.5",
        noPrice: "0.328260245",
        secondaryYesPrice: "500000000",
        secondaryNoPrice: "0",
      }),
      [],
      NOW,
    );
    expect(s.probability).toMatchObject({ yes: null, no: null, source: "unavailable", reason: "not_applicable" });
    expect(s.riskFlags.map((f) => f.id)).not.toContain("inconsistent_prices");
    expect(s.riskFlags.map((f) => f.id)).not.toContain("incomplete_prices");
    expect(s.dataQuality.reasons.join(" ")).not.toMatch(/inconsistent/i);
    expect(s.divergence.reason).toMatch(/not applicable/i);
  });
  it("primary incoherent → inconsistent flag and quality cap kept", () => {
    const s = computeMarketSignals(
      m({ phase: "primary", status: "primary", yesPrice: "0.5", noPrice: "0.328260245" }),
      [],
      NOW,
    );
    expect(s.probability.reason).toBe("inconsistent_prices");
    expect(s.riskFlags.map((f) => f.id)).toContain("inconsistent_prices");
    expect(s.dataQuality.grade).toBe("low");
    expect(s.dataQuality.reasons.join(" ")).toMatch(/inconsistent/i);
  });
  it("one-sided primary price → incomplete_prices flag", () => {
    const s = computeMarketSignals(m({ phase: "primary", status: "primary", yesPrice: "0.6", noPrice: null }), [], NOW);
    expect(s.probability.reason).toBe("incomplete_prices");
    expect(s.riskFlags.map((f) => f.id)).toContain("incomplete_prices");
  });
});

describe("template brief with inconsistent prices", () => {
  it("secondary: last-observed prices, never 100% probability language", async () => {
    const { buildTemplateBrief } = await import("@/lib/brief");
    const market = m({ yesPrice: "1", noPrice: "1" }); // default phase secondary
    const s = computeMarketSignals(market, [], Date.UTC(2026, 9, 3, 3, 0, 0));
    const text = buildTemplateBrief(market, s, "desk");
    expect(text).toMatch(/Last observed YES secondary price/);
    expect(text).toMatch(/not probabilities|not a YES probability|not applicable/i);
    expect(text).not.toMatch(/YES\/NO prices are inconsistent/i);
    expect(text).not.toMatch(/YES at 100/);
    expect(text).not.toMatch(/Market probability: YES 100/);
  });
  it("primary: says the probability is unavailable and never prints 100%", async () => {
    const { buildTemplateBrief } = await import("@/lib/brief");
    const market = m({ phase: "primary", status: "primary", yesPrice: "1", noPrice: "1" });
    const s = computeMarketSignals(market, [], Date.UTC(2026, 9, 3, 3, 0, 0));
    const text = buildTemplateBrief(market, s, "desk");
    expect(text).toMatch(/probability is unavailable|probability: unavailable|no usable probability/i);
    expect(text).toMatch(/inconsistent/);
    expect(text).not.toMatch(/YES at 100/);
  });
});

describe("decodeSecondaryPriceField / secondaryLastObservedPrices", () => {
  it("0 means no observation (never 0.00 USDC)", async () => {
    const { decodeSecondaryPriceField, secondaryLastObservedPrices } = await import("@/lib/panta/prices");
    expect(decodeSecondaryPriceField(0)).toBeNull();
    expect(decodeSecondaryPriceField("0")).toBeNull();
    expect(decodeSecondaryPriceField("800000000")).toBeCloseTo(0.8);
    expect(decodeSecondaryPriceField("1000000000")).toBe(1);
    expect(decodeSecondaryPriceField("0.506406474")).toBeCloseTo(0.506406474);
    const ansem = secondaryLastObservedPrices(
      m({ secondaryYesPrice: "0", secondaryNoPrice: "800000000", yesPrice: "0.671", noPrice: "0.8" }),
    );
    expect(ansem.yes).toBeNull(); // 0 → —
    expect(ansem.no).toBeCloseTo(0.8);
    expect(ansem.observedAtLabel).toBe("time not provided");
    const france = secondaryLastObservedPrices(
      m({
        secondaryYesPrice: "506406474",
        secondaryNoPrice: "493593526",
        yesPrice: "0.506406474",
        noPrice: "0.493593526",
      }),
    );
    expect(france.yes).toBeCloseTo(0.506406474);
    expect(france.no).toBeCloseTo(0.493593526);
  });
});

describe("deskPriceDisplay", () => {
  it("secondary shows USDC last-obs, not %", async () => {
    const { deskPriceDisplay } = await import("@/lib/format");
    const d = deskPriceDisplay(
      m({
        secondaryYesPrice: "506406474",
        secondaryNoPrice: "493593526",
        yesPrice: "0.506406474",
        noPrice: "0.493593526",
      }),
    );
    expect(d.mode).toBe("secondary");
    if (d.mode === "secondary") {
      expect(d.yesLabel).toMatch(/0\.506.*USDC/);
      expect(d.noLabel).toMatch(/0\.494.*USDC|0\.493.*USDC/);
    }
    const empty = deskPriceDisplay(m({ secondaryYesPrice: "0", secondaryNoPrice: "0" }));
    expect(empty.mode).toBe("unavailable");
    if (empty.mode === "unavailable") expect(empty.secondaryHint).toBe(true);
  });
});
