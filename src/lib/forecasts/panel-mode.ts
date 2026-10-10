/**
 * What the "Your forecast" block shows (pure; tested). The form appears ONLY
 * when the server-evaluated window is open; every other eligibility
 * (secondary, ended, resolved, cancelled, unknown, unavailable, no cutoff)
 * gets a closed-state summary. A hidden form is presentation only: the server
 * re-checks the window fresh on every write and rejects a stale client.
 */

import type { ForecastEligibility } from "./window-public";

export type YourForecastMode =
  | "closed"
  | "closed-verify"
  | "closed-current"
  | "connect"
  | "session-loading"
  | "verify"
  | "mine-loading"
  | "mine-error"
  | "current"
  | "form";

export type YourForecastInput = {
  eligibility: ForecastEligibility;
  connected: boolean;
  sessionPending: boolean;
  verified: boolean;
  minePending: boolean;
  mineError: boolean;
  hasCurrent: boolean;
  editing: boolean;
};

export function yourForecastMode(i: YourForecastInput): YourForecastMode {
  if (i.eligibility !== "open") {
    if (!i.connected) return "closed";
    if (i.sessionPending) return "session-loading";
    if (!i.verified) return "closed-verify";
    if (i.minePending) return "mine-loading";
    if (i.mineError) return "mine-error";
    return i.hasCurrent ? "closed-current" : "closed";
  }
  if (!i.connected) return "connect";
  if (i.sessionPending) return "session-loading";
  if (!i.verified) return "verify";
  if (i.minePending) return "mine-loading";
  if (i.mineError) return "mine-error";
  if (i.hasCurrent && !i.editing) return "current";
  return "form";
}

/** Modes that render the forecast form (slider + submit). */
export const FORM_MODES: ReadonlySet<YourForecastMode> = new Set(["form"]);
