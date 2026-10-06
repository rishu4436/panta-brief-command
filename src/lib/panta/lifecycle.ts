/**
 * Canonical market identity + lifecycle state (Stage D, docs/MARKET_LIFECYCLE.md).
 *
 * A pure view over the existing Market model and merge layer: it never changes
 * mergeMarket / resolveAuthoritativeMarket / marketLifecycle, it only names the
 * one state every surface shows. Rules:
 *  - expiry alone never gives "resolved" (marketLifecycle → "ended" = closed);
 *  - an API failure is "unavailable", never closed or resolved;
 *  - a failed quote is "quote unavailable", never a 0 % price;
 *  - "awaiting indexing" needs evidence (a checked registration receipt);
 *  - once Panta returns the market, its record wins over any local evidence.
 */

import { LIFECYCLE_LABEL, marketLifecycle, type Lifecycle } from "./catalog";
import type { Market } from "./domain";
import { BASE58_PUBKEY_RE } from "./routes";

/** The Panta market id (= Event PDA): base58, 32–44 chars. null when malformed. */
export function canonicalMarketId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return BASE58_PUBKEY_RE.test(id) ? id : null;
}

/** The one detail route for a market (catalog, positions, activity, create). */
export function marketHref(marketId: string): string {
  return `/markets/${encodeURIComponent(marketId.trim())}`;
}

export type MarketStateKind =
  | "loading"
  | "active"
  | "quote_unavailable"
  | "closed"
  | "resolved"
  | "cancelled"
  | "unknown"
  | "awaiting_indexing"
  | "registration_needs_attention"
  | "unavailable";

export type MarketStateTone = "live" | "info" | "pending" | "neutral" | "warning" | "error";

export type MarketState = {
  kind: MarketStateKind;
  /** Short badge text. */
  label: string;
  /** One plain sentence: what this means for the user. */
  detail: string;
  tone: MarketStateTone;
  /** The primary buy ticket can be used here right now. */
  tradableHere: boolean;
  lifecycle: Lifecycle | null;
  outcome: "yes" | "no" | null;
  /** Only for kind "unavailable". */
  reason?: "not_found" | "api_error";
};

/** Local evidence that a market was created + registered (see created-markets.ts). */
export type CreatedEvidence = { marketId: string; signature?: string | null; registeredAt?: number };

export type MarketStateInput = {
  marketId: string;
  market: Market | null | undefined;
  /** Still loading with nothing to show. */
  loading?: boolean;
  /** Detail/catalog fetch error (only matters when there is no market). */
  error?: unknown;
  /** Panta answered and has no record for this id. */
  notFound?: boolean;
  /** The ticket's last quote on this market came back PANTA_PRICING_UNAVAILABLE (recently). */
  quoteUnavailable?: boolean;
  createdEvidence?: CreatedEvidence | null;
  /** A create recovery record for this Event PDA still needs registration. */
  registrationNeedsAttention?: boolean;
  now?: number;
};

const OUTCOME_TEXT = { yes: "YES", no: "NO" } as const;

/** True when Panta itself (list or detail) has a record of this market. */
export function isPantaIndexed(m: Market | null | undefined): boolean {
  if (!m) return false;
  // Rows without provenance come from the Panta detail/list adapters.
  if (!m.sources) return true;
  return m.sources.list || m.sources.detail;
}

export function marketState(input: MarketStateInput): MarketState {
  const { market } = input;
  const id = input.marketId.trim();
  const base = { tradableHere: false, outcome: null, lifecycle: null } as const;

  // Registration incomplete and Panta has no record: never tradable.
  if (input.registrationNeedsAttention && !isPantaIndexed(market)) {
    return {
      ...base,
      kind: "registration_needs_attention",
      label: "Registration needs attention",
      detail: "The create transaction is confirmed, but Panta registration isn't finished. Finish it on Create.",
      tone: "warning",
      lifecycle: market ? marketLifecycle(market, input.now) : null,
    };
  }

  // Registered (checked receipt) but Panta's list/detail has no record yet. An
  // on-chain-only catalog row doesn't count as indexed: Panta can't quote it.
  const ev = input.createdEvidence;
  if (ev && ev.marketId === id && !isPantaIndexed(market) && !(input.loading && !market)) {
    return {
      ...base,
      kind: "awaiting_indexing",
      label: "Waiting for Panta indexing",
      detail: "Created successfully and registered with Panta. It becomes tradable here once Panta indexes it.",
      tone: "pending",
      lifecycle: market ? marketLifecycle(market, input.now) : null,
    };
  }

  if (market) {
    const lc = marketLifecycle(market, input.now);
    const outcome = lc === "resolved" && market.outcome ? market.outcome : null;
    switch (lc) {
      case "resolved":
        return {
          ...base,
          kind: "resolved",
          lifecycle: lc,
          outcome,
          label: outcome ? `Resolved · ${OUTCOME_TEXT[outcome]}` : "Resolved",
          detail: outcome
            ? `Panta resolved this market: ${OUTCOME_TEXT[outcome]} won. Winning positions are claimable in your Book.`
            : "Panta marks this market resolved. The outcome isn't in this record yet.",
          tone: "neutral",
        };
      case "cancelled":
        return { ...base, kind: "cancelled", lifecycle: lc, label: LIFECYCLE_LABEL.cancelled, detail: "Panta cancelled this market. No new trades.", tone: "error" };
      case "ended":
        return {
          ...base,
          kind: "closed",
          lifecycle: lc,
          label: LIFECYCLE_LABEL.ended,
          detail: "Trading has closed. Panta hasn't published a result yet. Closing time alone isn't a resolution.",
          tone: "pending",
        };
      case "trading":
        return {
          ...base,
          kind: "active",
          lifecycle: lc,
          label: LIFECYCLE_LABEL.trading,
          detail: "Secondary trading runs on panta.market. Prices here are independent last-observed values, not probabilities.",
          tone: "info",
        };
      case "open":
        if (input.quoteUnavailable) {
          return {
            ...base,
            kind: "quote_unavailable",
            lifecycle: lc,
            label: "Quote unavailable",
            detail: "The market is open, but Panta isn't pricing it right now. This is temporary and isn't a 0 % price.",
            tone: "warning",
          };
        }
        return {
          ...base,
          kind: "active",
          lifecycle: lc,
          tradableHere: true,
          label: LIFECYCLE_LABEL.open,
          detail: "Primary buy window is open. Buy YES or NO with a live Panta quote.",
          tone: "live",
        };
      default:
        return {
          ...base,
          kind: "unknown",
          lifecycle: lc,
          label: LIFECYCLE_LABEL.unknown,
          detail: `Panta reports a phase this app doesn't recognise${market.phase ? ` (“${market.phase.slice(0, 24)}”)` : ""}. Trading is off here.`,
          tone: "neutral",
        };
    }
  }

  if (input.loading) {
    return { ...base, kind: "loading", label: "Loading", detail: "Loading the market from Panta…", tone: "neutral" };
  }
  if (input.notFound) {
    return {
      ...base,
      kind: "unavailable",
      reason: "not_found",
      label: "Not indexed by Panta",
      detail: "Panta has no market with this id. Check the link, or wait if it was just created.",
      tone: "neutral",
    };
  }
  return {
    ...base,
    kind: "unavailable",
    reason: "api_error",
    label: "Panta API unavailable",
    detail: "Panta didn't answer. The market's status is unknown, not closed. Try again.",
    tone: "error",
  };
}

/** "MARKET_NOT_FOUND" from hooks.loadMarket: Panta answered with no record. */
export function isMarketNotFound(err: unknown): boolean {
  return err instanceof Error && err.message === "MARKET_NOT_FOUND";
}
