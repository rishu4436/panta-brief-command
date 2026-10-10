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
