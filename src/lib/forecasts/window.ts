/**
 * Forecast window policy (pure; shared by server and tests).
 *
 * Forecasts are accepted only while the linked Panta market is OPEN FOR
 * PRIMARY PARTICIPATION and before the FORECAST CUTOFF:
 *
 *   cutoff = Panta's `primaryPhaseEndTime` (end of the primary buy window, the
 *            same timestamp the canonical lifecycle in lib/panta/catalog.ts
 *            uses to turn "Primary · open" into closed), or the event
 *            `endTime` if that is earlier. When sources disagree, the EARLIEST
 *            reported time wins.
 *
 * Every source must agree the market is open: the fresh Panta detail record
 * (required, fetched server-side with no cache) and, when available, the
 * catalog row (on-chain lifecycle). Phases only move forward (primary →
 * secondary → ended/resolved), so the MOST ADVANCED state any source reports
 * is the truth: a stale catalog row can never re-open a market a newer record
 * shows closed, and vice versa. Secondary, ended, resolved, cancelled and
 * unknown all block writes. If Panta can't be reached, the record is partial
 * with no other source, or no cutoff is published, writes fail closed.
 *
 * Reads are never gated: existing forecasts stay visible after the cutoff.
 */

import { marketLifecycle, resolveAuthoritativeMarket, type Lifecycle } from "@/lib/panta/catalog";
import type { Market } from "@/lib/panta/domain";
import { isPartialMarket, isPricelessDetail } from "@/lib/panta/markets";

export type ForecastClosedReason =
  | "secondary"
  | "ended"
  | "resolved"
  | "cancelled"
  | "unknown"
  | "cutoff_passed"
  | "no_cutoff"
  | "not_found"
  | "unavailable";

export type ForecastWindow =
  | { open: true; cutoffAt: number; lifecycle: "open"; checkedAt: number }
  | { open: false; reason: ForecastClosedReason; message: string; cutoffAt: number | null; lifecycle: Lifecycle | null; checkedAt: number };

export const FORECAST_CLOSED_TEXT: Record<ForecastClosedReason, string> = {
  secondary: "Forecasting closed: the market's primary window has ended and it now trades on the secondary market.",
  ended: "Forecasting closed: the market has ended and is awaiting its result.",
  resolved: "Forecasting closed: Panta has resolved this market.",
  cancelled: "Forecasting closed: Panta cancelled this market.",
  unknown: "Forecasting is paused: Panta's record doesn't say which phase this market is in.",
  cutoff_passed: "Forecasting closed: the forecast cutoff (end of the primary window) has passed.",
  no_cutoff: "Forecasting is paused: Panta hasn't published when this market's primary window closes.",
  not_found: "Forecasting is unavailable: Panta has no market with this id.",
  unavailable: "Forecasting is paused: Panta couldn't be reached to confirm the market is still open. Nothing was saved. Try again.",
};

const LIFECYCLE_TO_REASON: Record<Exclude<Lifecycle, "open">, ForecastClosedReason> = {
  trading: "secondary",
  ended: "ended",
  resolved: "resolved",
  cancelled: "cancelled",
  unknown: "unknown",
};

/** Most advanced first: the strongest reason any source gives wins. */
const SEVERITY: Lifecycle[] = ["resolved", "cancelled", "ended", "trading", "unknown"];

export type WindowInput = {
  /** Catalog row (on-chain lifecycle + list), when the catalog had one. */
  row?: Market | null;
  /** Fresh Panta detail record. */
  detail: Market | null;
  detailStatus: "ok" | "not_found" | "failed";
  /** Server clock, unix ms. */
  nowMs: number;
};

const closed = (reason: ForecastClosedReason, nowMs: number, cutoffAt: number | null, lifecycle: Lifecycle | null): ForecastWindow => ({
  open: false,
  reason,
  message: FORECAST_CLOSED_TEXT[reason],
  cutoffAt,
  lifecycle,
  checkedAt: nowMs,
});

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function evaluateForecastWindow({ row, detail, detailStatus, nowMs }: WindowInput): ForecastWindow {
  const nowSec = Math.floor(nowMs / 1000);
  if (detailStatus === "failed") return closed("unavailable", nowMs, null, null);
  if (detailStatus === "not_found" || (!detail && !row)) return closed(detailStatus === "not_found" ? "not_found" : "unavailable", nowMs, null, null);

  const thinDetail = Boolean(detail && (detail.partial || isPartialMarket(detail) || isPricelessDetail(detail)));
  // A thin detail with no catalog row may carry a stale phase: can't confirm "open".
  if (!detail || (thinDetail && !row)) {
    const lc = detail ? marketLifecycle(detail, nowSec) : null;
    if (lc && lc !== "open" && lc !== "unknown") return closed(LIFECYCLE_TO_REASON[lc], nowMs, null, lc);
    return closed("unavailable", nowMs, null, lc);
  }

  const merged = resolveAuthoritativeMarket(row ?? null, detail);
  const sources: Market[] = [merged!];
  if (row) sources.push(row);
  sources.push(detail);

  const lifecycles = sources.map((m, i) => {
    const lc = marketLifecycle(m, nowSec);
    // A thin detail's missing phase isn't evidence of anything; its later phases still count.
    return i === sources.length - 1 && thinDetail && lc === "unknown" ? "open" : lc;
  });

  const cutoffs = sources.flatMap((m) => [m.primaryPhaseEndTime, m.endTime]).filter(positive);
  const ppe = sources.map((m) => m.primaryPhaseEndTime).filter(positive);
  const cutoffAt = cutoffs.length ? Math.min(...cutoffs) * 1000 : null;

  for (const s of SEVERITY) {
    if (lifecycles.includes(s)) return closed(LIFECYCLE_TO_REASON[s as Exclude<Lifecycle, "open">], nowMs, cutoffAt, s);
  }
  if (!ppe.length || cutoffAt === null) return closed("no_cutoff", nowMs, null, "open");
  if (nowMs >= cutoffAt) return closed("cutoff_passed", nowMs, cutoffAt, "ended");
  return { open: true, cutoffAt, lifecycle: "open", checkedAt: nowMs };
}
