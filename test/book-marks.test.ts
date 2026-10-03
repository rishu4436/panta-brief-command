/**
 * P2 #6: Book marks prefer Panta's own valuation when present and valid,
 * use settlement once resolved, never mark from incoherent prices, and are
 * explicitly unavailable otherwise (never 0 by default).
 */
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/positions.live-2026-10-03.json";
import { parsePositions } from "@/lib/panta/positions";
import { bookMark, pantaValuation } from "@/lib/panta/position-value";
import { marketProbability } from "@/lib/panta/prices";
import type { Position } from "@/lib/panta/domain";

const [primaryNo, secYes, secNo] = parsePositions(fixture);
const coherent = marketProbability({ phase: "secondary", yesPrice: "0.52", noPrice: "0.48" });
const incoherent = marketProbability({ phase: "secondary", yesPrice: "1", noPrice: "1" });
const oneSided = marketProbability({ phase: "secondary", yesPrice: "0.6", noPrice: null });

const withVal = (p: Position, patch: Partial<NonNullable<Position["valuation"]>>): Position => ({
  ...p,
  valuation: { ...p.valuation!, ...patch },
});
const bare = (p: Partial<Position>): Position => ({
  marketId: "M",
  category: null,
  side: "yes",
  shares: "10",
  sharesNum: 10,
  phase: "secondary",
  claimable: false,
  claimed: false,
  outcome: null,
  title: null,
  ...p,
});

describe("parsing the live positions payload", () => {
  it("keeps Panta's valuation fields raw", () => {
    expect(primaryNo.valuation).toEqual({
      price: "0.4951937",
      priceSource: "primary_last",
      status: "complete",
      currentValueUsdc: "5.043216",
      currentValueUsdcBase: "5043216",
      claimedPayoutUsdc: null,
    });
    expect(secYes.valuation?.status).toBe("indicative");
  });
});

describe("Panta valuation preferred when valid", () => {
  it("complete primary valuation is used as-is (no market prices needed)", () => {
    expect(bookMark(primaryNo, undefined)).toMatchObject({ value: 5.043216, source: "panta", indicative: false });
  });
  it("indicative secondary valuation is used when the market prices validate", () => {
    expect(bookMark(secYes, coherent)).toMatchObject({ value: 4.96984, source: "panta", indicative: true });
    expect(bookMark(secNo, coherent)).toMatchObject({ value: 5.029019, source: "panta", indicative: true });
  });
  it("indicative valuation on top of incoherent / one-sided prices is NOT a mark", () => {
    expect(bookMark(secYes, incoherent)).toMatchObject({ value: null, reason: "inconsistent_prices" });
    expect(bookMark(secYes, oneSided)).toMatchObject({ value: null, reason: "incomplete_prices" });
  });
  it("indicative valuation waits for prices instead of guessing", () => {
    expect(bookMark(secYes, undefined)).toMatchObject({ value: null, reason: "pending_prices" });
  });
});

describe("invalid Panta valuation is rejected, not trusted and not zeroed", () => {
  it("shares × price ≠ currentValueUsdc", () => {
    const p = withVal(primaryNo, { currentValueUsdc: "9.99", currentValueUsdcBase: "9990000" });
    expect(typeof pantaValuation(p, coherent)).toBe("string");
    expect(bookMark(p, coherent)).toMatchObject({ value: null, reason: "panta_valuation_invalid" });
  });
  it("human vs base value disagree", () => {
    expect(bookMark(withVal(primaryNo, { currentValueUsdcBase: "6043216" }), coherent)).toMatchObject({ value: null });
  });
  it("price outside [0, 1]", () => {
    expect(bookMark(withVal(primaryNo, { price: "1.4" }), coherent)).toMatchObject({ value: null, reason: "panta_valuation_invalid" });
  });
  it("unknown / missing valuationStatus", () => {
    expect(bookMark(withVal(primaryNo, { status: "stale" }), coherent)).toMatchObject({ value: null });
    expect(bookMark(withVal(primaryNo, { status: null }), coherent)).toMatchObject({ value: null });
  });
  it("negative or non-numeric value", () => {
    expect(bookMark(withVal(primaryNo, { currentValueUsdc: "-1", currentValueUsdcBase: null }), coherent).value).toBeNull();
    expect(bookMark(withVal(primaryNo, { currentValueUsdc: "abc", currentValueUsdcBase: null }), coherent).value).toBeNull();
  });
  it("indicative with no price can't be checked", () => {
    expect(bookMark(withVal(secYes, { price: null }), coherent)).toMatchObject({ value: null, reason: "panta_valuation_invalid" });
  });
  it("a genuine zero valuation stays 0 (not unavailable)", () => {
    const p = withVal(primaryNo, { price: "0", currentValueUsdc: "0", currentValueUsdcBase: "0" });
    expect(bookMark(p, undefined)).toMatchObject({ value: 0, source: "panta" });
  });
});

describe("fallbacks without a Panta valuation", () => {
  it("open market: validated spot × shares", () => {
    expect(bookMark(bare({}), coherent)).toMatchObject({ value: 5.2, source: "spot" });
  });
  it("open market with incoherent prices: unavailable, never a number", () => {
    expect(bookMark(bare({}), incoherent)).toMatchObject({ value: null, reason: "inconsistent_prices" });
  });
  it("resolved winner = shares × 1, loser = 0 (settlement, spot ignored)", () => {
    expect(bookMark(bare({ phase: "resolved", outcome: "yes" }), incoherent)).toMatchObject({ value: 10, source: "settlement" });
    expect(bookMark(bare({ phase: "resolved", outcome: "no" }), incoherent)).toMatchObject({ value: 0, source: "settlement" });
  });
  it("resolved with unknown outcome: unavailable (no spot)", () => {
    expect(bookMark(bare({ phase: "resolved", outcome: null }), coherent).value).toBeNull();
  });
  it("cancelled / claimed / unknown side / unknown shares: unavailable", () => {
    expect(bookMark(bare({ phase: "cancelled" }), coherent)).toMatchObject({ value: null, reason: "cancelled" });
    expect(bookMark(bare({ phase: "resolved", outcome: "yes", claimed: true }), coherent)).toMatchObject({ value: null, reason: "claimed" });
    expect(bookMark(bare({ side: null }), coherent)).toMatchObject({ value: null, reason: "unknown_side" });
    expect(bookMark(bare({ sharesNum: null, shares: "" }), coherent)).toMatchObject({ value: null, reason: "unknown_shares" });
  });
  it("prices not loaded yet: pending, not 0", () => {
    expect(bookMark(bare({}), undefined)).toMatchObject({ value: null, reason: "pending_prices" });
  });
});
