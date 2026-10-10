/**
 * What a room shows about its market, derived ONLY from the canonical Market
 * (Panta + on-chain merge) and the Stage D MarketState. Nothing is stored on
 * the room; nothing is inferred from timestamps or invented when missing.
 *
 *  - primary / resolved: validated YES/NO probabilities (or "unavailable");
 *  - secondary: last-observed USDC per share per side, never a probability;
 *  - missing prices are "unavailable", never 0 %.
 */

import { deskPriceDisplay } from "@/lib/format";
import type { Market } from "@/lib/panta/domain";
import { marketHref, type MarketState } from "@/lib/panta/lifecycle";
import { PROBABILITY_UNAVAILABLE_TEXT } from "@/lib/panta/prices";

export type RoomMarketPrice =
  | { kind: "probability"; yes: number; no: number; settled: boolean }
  | { kind: "secondary_last_observed"; yesUsdc: number | null; noUsdc: number | null }
  | { kind: "unavailable"; text: string };

export function roomMarketPrice(market: Market | null | undefined, state: MarketState): RoomMarketPrice {
  if (!market) return { kind: "unavailable", text: state.kind === "loading" ? "Loading Panta prices…" : "No Panta price available." };
  const d = deskPriceDisplay(market);
  if (d.mode === "secondary") return { kind: "secondary_last_observed", yesUsdc: d.yes, noUsdc: d.no };
  if (d.mode === "unavailable") {
    return {
      kind: "unavailable",
      text: d.secondaryHint ? "No last-observed secondary price on either side." : PROBABILITY_UNAVAILABLE_TEXT[d.unavailable].long,
    };
  }
  return { kind: "probability", yes: Number(d.yes), no: Number(d.no), settled: state.kind === "resolved" };
}

export type RoomMarketTiming = { label: string; unix: number };

/** Timing that Panta / the chain actually reported, in lifecycle order. */
export function roomMarketTiming(market: Market | null | undefined): RoomMarketTiming[] {
  if (!market) return [];
  const out: RoomMarketTiming[] = [];
  const add = (label: string, v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out.push({ label, unix: v });
  };
  add("Buy window closes", market.primaryPhaseEndTime);
  add("Event ends", market.endTime);
  add("Resolution expected", market.resolutionTime);
  return out;
}

export type RoomMarketCta = { href: string; label: string; detail: string };

/** The one link into the existing market workspace (detail + trading). */
export function roomMarketCta(marketId: string, state: MarketState): RoomMarketCta {
  const href = marketHref(marketId);
  switch (state.kind) {
    case "active":
      return state.tradableHere
        ? { href, label: "Open market & trade", detail: "Quote and buy YES or NO with your wallet on the market page." }
        : { href, label: "Open market", detail: "Secondary trading runs on panta.market; the market page shows live flow." };
    case "quote_unavailable":
      return { href, label: "Open market", detail: "Panta isn't quoting right now. The market page retries live." };
    case "resolved":
      return { href, label: "Open market", detail: "See the result and claim winnings in your Book." };
    case "closed":
      return { href, label: "Open market", detail: "Trading has closed; Panta hasn't published a result yet." };
    default:
      return { href, label: "Open market", detail: "The market page shows Panta's latest record." };
  }
}
