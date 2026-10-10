/**
 * Position Intelligence (Book /book): pure aggregation over positions,
 * bookMark() values and authoritative market lifecycle. No network, no
 * invented P&L / average entry / cost basis.
 */

import { marketLifecycle, type Lifecycle } from "./catalog";
import type { Market, Position } from "./domain";
import { bookMark, type BookMark, type MarkSource } from "./position-value";
import type { MarketProbability } from "./prices";
import { formatResolutionCountdown } from "@/lib/format";
export { formatResolutionCountdown };

export type IntelLifecycle = "primary" | "secondary" | "resolved" | "cancelled" | "unknown";

export type MarkSourceLabel = "Panta valuation" | "Indicative" | "Settlement" | "Validated spot" | "Unavailable";

export type ResolutionKind = "countdown" | "resolved" | "awaiting" | "unknown";
export type ResolutionIntel = { kind: ResolutionKind; label: string; totalSec: number | null };

export type ClaimReadinessStatus =
  | "claimable"
  | "claimed"
  | "not_yet"
  | "resolution_pending"
  | "lost"
  | "unavailable";

export type ClaimReadiness = { status: ClaimReadinessStatus; label: string };

export type PositionIntelRow = {
  position: Position;
  title: string;
  marketId: string;
  side: "yes" | "no" | null;
  shares: string;
  mark: BookMark;
  markSourceLabel: MarkSourceLabel;
  lifecycle: IntelLifecycle;
  resolution: ResolutionIntel;
  claim: ClaimReadiness;
  /** Validated mark value, or null when unavailable (never coerced to 0). */
  validMark: number | null;
};

export type LargestPosition = {
  marketId: string;
  title: string;
  side: "yes" | "no" | null;
  shares: string;
  markedValue: number;
  percentOfValid: number;
};

export type PortfolioIntel = {
  positionCount: number;
  /** Sum of valid (non-null) marks only. */
  totalValidMarked: number;
  validMarkCount: number;
  unavailableMarkCount: number;
  claimableCount: number;
  activeCount: number;
  secondaryCount: number;
  resolvedCount: number;
  yesExposure: number;
  noExposure: number;
  largest: LargestPosition | null;
  /** True when at least one mark was unavailable and at least one was valid. */
  hasPartialMarks: boolean;
  /** True when every position lacks a valid mark (or there are no positions). */
  noValidMarks: boolean;
  /** Count of rows still waiting on bookMark inputs (pending_prices). */
  pendingMarkCount: number;
  /**
   * True when positions exist, no valid marks yet, and at least one mark is
   * still pending_prices (market detail / price inputs loading). UI should
   * show a neutral loading state — not "unavailable".
   */
  marksPending: boolean;
};

export type FreshnessKind = "just_now" | "ago" | "refreshing" | "failed" | "idle";
export type Freshness = { kind: FreshnessKind; label: string; ageSec: number | null };

export const PNL_UNAVAILABLE_NOTE =
  "P&L unavailable · Panta does not expose a complete cost basis for every position through the current partner surfaces.";

export const POSITIONS_VS_ACTIVITY_NOTE =
  "Positions are the connected wallet's current holdings from Panta. Activity lists trades and claims attributed to this Brief Command API key — not a complete wallet history.";

const nowSec = (nowMs: number) => Math.floor(nowMs / 1000);

/** Map catalog Lifecycle → the Book's five lifecycle labels. */
export function toIntelLifecycle(lc: Lifecycle, phaseHint?: string | null): IntelLifecycle {
  if (lc === "open") return "primary";
  if (lc === "trading") return "secondary";
  if (lc === "resolved") return "resolved";
  if (lc === "cancelled") return "cancelled";
  if (lc === "ended") {
    // Event ended, awaiting result: keep the underlying phase when known.
    const p = (phaseHint || "").toLowerCase();
    if (p === "secondary") return "secondary";
    if (p === "primary") return "primary";
    return "unknown";
  }
  return "unknown";
}

/**
 * Lifecycle for a position: authoritative market cache first (catalog/detail),
 * never inferred from price fields alone. Falls back to the position's own
 * phase from GET /positions/.
 */
export function positionLifecycle(
  position: Pick<Position, "phase">,
  market: Pick<Market, "phase" | "status" | "resolved" | "endTime" | "primaryPhaseEndTime"> | null | undefined,
  nowMs: number,
): IntelLifecycle {
  if (market) {
    const lc = marketLifecycle(market, nowSec(nowMs));
    return toIntelLifecycle(lc, market.phase || position.phase);
  }
  const p = (position.phase || "").toLowerCase();
  if (p === "primary") return "primary";
  if (p === "secondary") return "secondary";
  if (p === "resolved") return "resolved";
  if (p === "cancelled" || p === "canceled") return "cancelled";
  return "unknown";
}

/** Human mark-source label derived only from bookMark()'s result. */
export function markSourceLabel(mk: BookMark): MarkSourceLabel {
  if (mk.value == null) return "Unavailable";
  if (mk.source === "settlement") return "Settlement";
  if (mk.source === "spot") return "Validated spot";
  if (mk.source === "panta") return mk.indicative ? "Indicative" : "Panta valuation";
  return "Unavailable";
}

/**
 * Resolution intelligence from existing timestamps only — never invents times.
 * Prefers resolutionTime, then endTime, from the authoritative market.
 */
export function resolutionIntel(
  market: Pick<Market, "endTime" | "resolutionTime" | "resolved" | "phase" | "status"> | null | undefined,
  lifecycle: IntelLifecycle,
  nowMs: number,
): ResolutionIntel {
  if (lifecycle === "resolved" || market?.resolved || (market?.phase || "").toLowerCase() === "resolved") {
    return { kind: "resolved", label: "Resolved", totalSec: null };
  }
  const ts =
    typeof market?.resolutionTime === "number" && market.resolutionTime > 0
      ? market.resolutionTime
      : typeof market?.endTime === "number" && market.endTime > 0
        ? market.endTime
        : null;
  if (ts == null) return { kind: "unknown", label: "Unknown", totalSec: null };
  const remaining = ts - nowSec(nowMs);
  if (remaining <= 0) {
    return { kind: "awaiting", label: "Event ended · awaiting resolution", totalSec: 0 };
  }
  return { kind: "countdown", label: formatResolutionCountdown(remaining), totalSec: remaining };
}

/**
 * Claim readiness from existing claimable/claimed flags + lifecycle.
 * Does not change claim tx construction.
 */
export function claimReadiness(position: Pick<Position, "claimable" | "claimed" | "phase">, lifecycle: IntelLifecycle): ClaimReadiness {
  if (position.claimed) return { status: "claimed", label: "Claimed" };
  if (position.claimable) return { status: "claimable", label: "Claimable" };
  if (lifecycle === "cancelled") return { status: "unavailable", label: "Unavailable" };
  // Event ended or resolved but Panta has not yet marked claimable (indexing delay).
  if (lifecycle === "resolved") return { status: "not_yet", label: "Not yet claimable" };
  const phase = (position.phase || "").toLowerCase();
  if (phase === "resolved") return { status: "not_yet", label: "Not yet claimable" };
  // Awaiting resolution after the event window.
  if (
    lifecycle === "unknown" &&
    (phase === "secondary" || phase === "primary" || phase === "")
  ) {
    /* fall through */
  }
  // Detect "event ended · awaiting" via caller passing lifecycle secondary/primary
  // with resolution kind awaiting — the row builder sets resolution_pending when
  // resolution.kind === "awaiting".
  if (lifecycle === "primary" || lifecycle === "secondary") {
    return { status: "not_yet", label: "Not yet claimable" };
  }
  return { status: "unavailable", label: "Unavailable" };
}

/** Refine claim readiness when we know the event has ended but is not resolved. */
export function claimReadinessWithResolution(
  position: Pick<Position, "claimable" | "claimed" | "phase"> & { side?: Position["side"] },
  lifecycle: IntelLifecycle,
  resolution: ResolutionIntel,
  outcome: "yes" | "no" | null = null,
): ClaimReadiness {
  // Panta's own flags always win.
  if (position.claimed) return { status: "claimed", label: "Claimed" };
  if (position.claimable) return { status: "claimable", label: "Claimable" };
  if (lifecycle === "cancelled") return { status: "unavailable", label: "Unavailable" };
  if (resolution.kind === "awaiting") return { status: "resolution_pending", label: "Resolution pending" };
  // Resolved with a known winner and this position is on the other side: it will
  // never become claimable, so don't say "Not yet claimable".
  if (lifecycle === "resolved" && outcome && (position.side === "yes" || position.side === "no") && position.side !== outcome) {
    return { status: "lost", label: "Lost · nothing to claim" };
  }
  if (lifecycle === "resolved") return { status: "not_yet", label: "Not yet claimable" };
  if (lifecycle === "primary" || lifecycle === "secondary") {
    return { status: "not_yet", label: "Not yet claimable" };
  }
  return { status: "unavailable", label: "Unavailable" };
}

export type MarketLookup = ReadonlyMap<string, Market> | Record<string, Market | undefined>;

function lookupMarket(markets: MarketLookup, id: string): Market | undefined {
  if (markets instanceof Map) return markets.get(id);
  return (markets as Record<string, Market | undefined>)[id];
}

/** Enrich one position with mark, lifecycle, resolution and claim readiness. */
export function enrichPosition(
  position: Position,
  px: MarketProbability | null | undefined,
  market: Market | null | undefined,
  nowMs: number,
): PositionIntelRow {
  const mark = bookMark(position, px);
  const lifecycle = positionLifecycle(position, market, nowMs);
  const resolution = resolutionIntel(market, lifecycle, nowMs);
  const claim = claimReadinessWithResolution(position, lifecycle, resolution, market?.outcome ?? null);
  const title = (market?.title || position.title || "").trim() || position.marketId;
  return {
    position,
    title,
    marketId: position.marketId,
    side: position.side,
    shares: position.shares,
    mark,
    markSourceLabel: markSourceLabel(mark),
    lifecycle,
    resolution,
    claim,
    validMark: mark.value != null ? mark.value : null,
  };
}

export function enrichPositions(
  positions: Position[],
  priceByMarket: Record<string, MarketProbability | undefined>,
  markets: MarketLookup,
  nowMs: number,
): PositionIntelRow[] {
  return positions.map((p) => enrichPosition(p, priceByMarket[p.marketId], lookupMarket(markets, p.marketId), nowMs));
}

/**
 * Portfolio overview. Sums only validated non-null marks; never converts
 * unavailable marks to zero. Largest position is among valid marks only.
 */
export function portfolioIntel(rows: PositionIntelRow[]): PortfolioIntel {
  let totalValidMarked = 0;
  let validMarkCount = 0;
  let unavailableMarkCount = 0;
  let pendingMarkCount = 0;
  let claimableCount = 0;
  let activeCount = 0;
  let secondaryCount = 0;
  let resolvedCount = 0;
  let yesExposure = 0;
  let noExposure = 0;
  let largest: LargestPosition | null = null;

  for (const r of rows) {
    if (r.claim.status === "claimable") claimableCount += 1;
    if (r.lifecycle === "primary" || r.lifecycle === "secondary") activeCount += 1;
    if (r.lifecycle === "secondary") secondaryCount += 1;
    if (r.lifecycle === "resolved") resolvedCount += 1;

    if (r.validMark == null) {
      if (r.mark.value == null && r.mark.reason === "pending_prices") pendingMarkCount += 1;
      else unavailableMarkCount += 1;
      continue;
    }
    validMarkCount += 1;
    totalValidMarked += r.validMark;
    if (r.side === "yes") yesExposure += r.validMark;
    else if (r.side === "no") noExposure += r.validMark;
    if (!largest || r.validMark > largest.markedValue) {
      largest = {
        marketId: r.marketId,
        title: r.title,
        side: r.side,
        shares: r.shares,
        markedValue: r.validMark,
        percentOfValid: 0, // filled below
      };
    }
  }

  if (largest && totalValidMarked > 0) {
    largest = {
      ...largest,
      percentOfValid: (largest.markedValue / totalValidMarked) * 100,
    };
  } else {
    largest = null;
  }

  return {
    positionCount: rows.length,
    totalValidMarked,
    validMarkCount,
    unavailableMarkCount,
    claimableCount,
    activeCount,
    secondaryCount,
    resolvedCount,
    yesExposure,
    noExposure,
    largest,
    hasPartialMarks: validMarkCount > 0 && unavailableMarkCount > 0,
    noValidMarks: validMarkCount === 0,
    pendingMarkCount,
    marksPending: rows.length > 0 && validMarkCount === 0 && pendingMarkCount > 0,
  };
}

export const LARGEST_UNAVAILABLE_NOTE = "Exposure unavailable · valid marks required";

export const MARKS_LOADING_NOTE = "Loading marks…";

/**
 * Data freshness from TanStack Query state. No new polling — labels only.
 * `updatedAtMs` is dataUpdatedAt; `nowMs` is Date.now().
 */
export function dataFreshness(opts: {
  updatedAtMs: number | null | undefined;
  isFetching: boolean;
  isError: boolean;
  hasData: boolean;
  nowMs: number;
}): Freshness {
  if (opts.isError && !opts.hasData) return { kind: "failed", label: "Refresh failed", ageSec: null };
  if (opts.isError && opts.hasData) {
    const age = opts.updatedAtMs ? Math.max(0, Math.floor((opts.nowMs - opts.updatedAtMs) / 1000)) : null;
    return { kind: "failed", label: age != null ? `Refresh failed · last update ${age}s ago` : "Refresh failed", ageSec: age };
  }
  if (opts.isFetching && !opts.hasData) return { kind: "refreshing", label: "Refreshing", ageSec: null };
  if (opts.isFetching && opts.hasData) return { kind: "refreshing", label: "Refreshing", ageSec: null };
  if (!opts.updatedAtMs) return { kind: "idle", label: "—", ageSec: null };
  const ageSec = Math.max(0, Math.floor((opts.nowMs - opts.updatedAtMs) / 1000));
  if (ageSec < 5) return { kind: "just_now", label: "Updated just now", ageSec };
  return { kind: "ago", label: `Updated ${ageSec}s ago`, ageSec };
}

/** Format a USDC mark for display (2 dp). */
export function formatMarkUsdc(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 })} USDC`;
}

export type { MarkSource, BookMark };
