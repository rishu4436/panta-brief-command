/**
 * Book mark for one position. Order of preference:
 *
 *  1. Panta's own valuation (`currentValueUsdc`, live /positions/ field) when
 *     it is present AND checks out:
 *       - valuationStatus is "complete" or "indicative" (any other / missing
 *         status is not trusted);
 *       - currentValueUsdc is a finite number ≥ 0, and agrees with
 *         currentValueUsdcBase / 1e6 when both are sent;
 *       - price (if sent) is inside [0, 1] and shares × price reproduces
 *         currentValueUsdc within VALUE_TOLERANCE (observed live: exact to
 *         rounding, e.g. 10.184331 × 0.4951937 = 5.0432163 vs "5.043216");
 *       - without a price, only a "complete" valuation is accepted;
 *       - an "indicative" valuation (secondary last trade, priced per side)
 *         is accepted only when the market's YES/NO prices validate as
 *         probabilities, never on top of incoherent prices.
 *  2. Resolved market with a known outcome (docs: settlement, not spot):
 *     winner = shares × 1 USDC, loser = 0.
 *  3. Open market: shares × validated side probability (positionMark).
 *  4. Otherwise: explicitly unavailable with a reason (never 0).
 */

import type { Position } from "./domain";
import { type MarketProbability, positionMark, type ProbabilityUnavailableReason } from "./prices";

/** |shares × price − value| allowed: 1e-5 USDC absolute or 0.1 % of the value. */
export const VALUE_ABS_TOLERANCE = 0.00001;
export const VALUE_REL_TOLERANCE = 0.001;

export type MarkSource = "panta" | "settlement" | "spot";

export type MarkUnavailableReason =
  | ProbabilityUnavailableReason
  | "unknown_side"
  | "unknown_shares"
  | "panta_valuation_invalid"
  | "cancelled"
  | "claimed"
  | "pending_prices";

export type BookMark =
  | { value: number; source: MarkSource; indicative: boolean; price: number | null; note: string }
  | { value: null; reason: MarkUnavailableReason; note: string };

const TRUSTED = new Set(["complete", "indicative"]);

const num = (s: string | null | undefined): number | null => {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(VALUE_ABS_TOLERANCE, VALUE_REL_TOLERANCE * Math.abs(b));

/** Panta's valuation if it is usable; a string reason if present but rejected; null if absent. */
export function pantaValuation(
  p: Position,
  px: MarketProbability | null | undefined,
): { value: number; price: number | null; indicative: boolean; source: string | null } | string | null {
  const v = p.valuation;
  if (!v || (v.currentValueUsdc == null && v.currentValueUsdcBase == null)) return null;
  const value = num(v.currentValueUsdc);
  if (value == null || value < 0) return "currentValueUsdc is not a non-negative number";
  const base = num(v.currentValueUsdcBase);
  if (v.currentValueUsdcBase != null && (base == null || Math.abs(base / 1e6 - value) > 0.0000015)) {
    return "currentValueUsdc and currentValueUsdcBase disagree";
  }
  if (!v.status || !TRUSTED.has(v.status)) return `valuationStatus "${v.status ?? "missing"}" is not trusted`;
  const price = num(v.price);
  if (v.price != null) {
    if (price == null || price < 0 || price > 1) return `price ${v.price} is outside [0, 1]`;
    if (p.sharesNum == null) return "shares missing, value can't be checked against price";
    if (!close(p.sharesNum * price, value)) return `shares × price (${(p.sharesNum * price).toFixed(6)}) ≠ currentValueUsdc ${v.currentValueUsdc}`;
  } else if (v.status !== "complete") {
    return "indicative valuation without a price can't be checked";
  }
  const indicative = v.status === "indicative";
  if (indicative) {
    if (!px) return "pending";
    if (px.yes == null || px.no == null) return `market prices are ${px.reason ?? "missing_prices"}`;
  }
  return { value, price, indicative, source: v.priceSource };
}

export function bookMark(p: Position, px: MarketProbability | null | undefined): BookMark {
  if (p.phase === "cancelled") return { value: null, reason: "cancelled", note: "Market cancelled: no mark." };
  const pv = pantaValuation(p, px);
  if (pv && typeof pv === "object") {
    return {
      value: pv.value,
      source: "panta",
      indicative: pv.indicative,
      price: pv.price,
      note: `Panta valuation (${pv.indicative ? "indicative" : "complete"}${pv.source ? `, ${pv.source}` : ""})`,
    };
  }
  if (pv === "pending") return { value: null, reason: "pending_prices", note: "Checking market prices…" };
  if (typeof pv === "string" && pv.startsWith("market prices are ") && px && px.yes == null) {
    // Indicative per-side price on a market whose YES/NO don't validate: no mark.
    const reason = px.reason ?? "missing_prices";
    return { value: null, reason, note: `Mark unavailable (${reason}); Panta's indicative value is not used.` };
  }

  const outcome = (p.outcome || "").toLowerCase();
  if (p.phase === "resolved" && (outcome === "yes" || outcome === "no")) {
    if (p.claimed) return { value: null, reason: "claimed", note: "Already claimed: settled, nothing left to mark." };
    if (p.side !== "yes" && p.side !== "no") return { value: null, reason: "unknown_side", note: "Side unknown." };
    if (p.sharesNum == null) return { value: null, reason: "unknown_shares", note: "Share count unknown." };
    const win = p.side === outcome;
    return {
      value: win ? p.sharesNum : 0,
      source: "settlement",
      indicative: false,
      price: win ? 1 : 0,
      note: win ? "Resolved winner: ≈1 USDC per share" : "Resolved loser: settles at 0",
    };
  }
  if (p.phase === "resolved") {
    return { value: null, reason: "panta_valuation_invalid", note: "Resolved but outcome unknown: spot prices are not used." };
  }

  if (typeof pv === "string") {
    // Panta sent a valuation we can't trust: say so rather than silently re-marking at spot.
    return { value: null, reason: "panta_valuation_invalid", note: `Panta valuation rejected: ${pv}.` };
  }
  if (!px) return { value: null, reason: "pending_prices", note: "Checking market prices…" };
  const mk = positionMark(p.sharesNum, p.side, px);
  if (mk.value == null) return { value: null, reason: mk.reason, note: `Mark unavailable (${mk.reason}).` };
  return { value: mk.value, source: "spot", indicative: false, price: mk.price, note: `shares × ${mk.price.toFixed(4)} (spot)` };
}
