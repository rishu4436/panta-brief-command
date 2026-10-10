/** Wire shape of a forecast window (ISO times; no internals). */

import type { Lifecycle } from "@/lib/panta/catalog";
import type { ForecastClosedReason, ForecastWindow } from "./window";

export type PublicForecastWindow = {
  open: boolean;
  reason: ForecastClosedReason | null;
  message: string | null;
  cutoffAt: string | null;
  lifecycle: Lifecycle | null;
  checkedAt: string;
};

export function publicWindow(w: ForecastWindow): PublicForecastWindow {
  return {
    open: w.open,
    reason: w.open ? null : w.reason,
    message: w.open ? null : w.message,
    cutoffAt: w.cutoffAt === null ? null : new Date(w.cutoffAt).toISOString(),
    lifecycle: w.lifecycle,
    checkedAt: new Date(w.checkedAt).toISOString(),
  };
}

/**
 * One effective forecasting state for every surface (room panel, Studio).
 * Derived ONLY from a server-evaluated window; nothing else may say "open".
 * "unknown" = the server couldn't confirm the phase or cutoff (paused, not forecastable).
 */
export type ForecastEligibility = "open" | "closed" | "unknown";

const PAUSED: ReadonlySet<ForecastClosedReason> = new Set(["unknown", "unavailable", "no_cutoff"]);

export function forecastEligibility(w: { open: boolean; reason: ForecastClosedReason | null } | null | undefined): ForecastEligibility {
  if (!w) return "unknown";
  if (w.open === true && w.reason === null) return "open";
  return w.reason && PAUSED.has(w.reason) ? "unknown" : "closed";
}

export const ELIGIBILITY_TEXT: Record<ForecastEligibility, string> = {
  open: "Forecasting open",
  closed: "Forecasting closed",
  unknown: "Forecasting paused",
};
