/** Client-side input validation for the execute ticket (Panta still validates server-side). */

import { ATTRIBUTION_REF_MAX, ATTRIBUTION_REF_RE } from "./routes";

/** Upper bound for a single primary buy from this desk (USDC). */
export const MAX_AMOUNT_USDC = 10_000;
/** Slippage bound for the UI. Panta allows up to 5000 bps (orders/build docs); we cap tighter. */
export const MAX_SLIPPAGE_BPS = 1_000;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const AMOUNT_RE = /^\d{1,7}(\.\d{1,2})?$/;

/** Returns a canonical 2-dp string (Panta primary buy amounts are human decimals, e.g. "20.00"). */
export function validateAmountUsdc(raw: string): Validated<string> {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Enter an amount." };
  if (!AMOUNT_RE.test(s)) {
    return { ok: false, error: "Use a plain number with up to 2 decimals (e.g. 25 or 25.50)." };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "Amount must be greater than 0." };
  if (n > MAX_AMOUNT_USDC) {
    return { ok: false, error: `Max ${MAX_AMOUNT_USDC.toLocaleString()} USDC per order.` };
  }
  return { ok: true, value: n.toFixed(2) };
}

export function validateSlippageBps(raw: string): Validated<number> {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Enter slippage in bps (e.g. 100 = 1%)." };
  if (!/^\d{1,4}$/.test(s)) return { ok: false, error: "Slippage must be a whole number of bps." };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SLIPPAGE_BPS) {
    return { ok: false, error: `Slippage must be 0–${MAX_SLIPPAGE_BPS} bps.` };
  }
  return { ok: true, value: n };
}

/** Empty is allowed (no attribution reference). */
export function validateAttributionRef(raw: string): Validated<string | undefined> {
  const s = raw.trim();
  if (!s) return { ok: true, value: undefined };
  if (s.length > ATTRIBUTION_REF_MAX) {
    return { ok: false, error: `Max ${ATTRIBUTION_REF_MAX} characters.` };
  }
  if (!ATTRIBUTION_REF_RE.test(s)) {
    return { ok: false, error: "Letters, digits, and _ . : - only." };
  }
  return { ok: true, value: s };
}
