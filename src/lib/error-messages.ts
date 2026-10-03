/**
 * The one mapping from internal / upstream error codes to text a person can
 * act on. UI code never shows a raw code on its own: `describeErr` (errors.ts)
 * turns any `{ code, detail }` body into `humanError(...)`. The code itself is
 * kept for support as a short "ref" suffix, and stays untouched in server
 * logs and the admin diagnostics endpoint.
 *
 * Panta codes: docs.panta.market/guides/errors (3 Oct 2026). Ours: the
 * /api/* route handlers and src/lib/panta/server.ts.
 */

export const ERROR_MESSAGES: Record<string, string> = {
  // Panta API
  UNAUTHORIZED: "Panta rejected the request's credentials or wallet binding.",
  FORBIDDEN: "Panta doesn't allow this operation.",
  INVALID_MARKET_PARAMS: "Panta rejected the request parameters.",
  QUOTE_EXPIRED: "This quote has expired. Get a new quote.",
  QUOTE_STALE: "The price moved beyond your slippage limit. Get a new quote.",
  AMOUNT_TOO_SMALL: "The amount is below Panta's minimum fill.",
  MARKET_NOT_FOUND: "Panta couldn't find this market.",
  MARKET_NOT_IN_PRIMARY: "This market isn't accepting primary buys.",
  NOT_CLAIMABLE: "There's nothing to claim on this market for this wallet yet.",
  NOT_MARKET_CREATOR: "This wallet isn't the creator of this market.",
  MARKET_NOT_GRADUATED: "Creator fees can't be claimed until the market graduates.",
  NO_CREATOR_FEES: "There are no creator fees to claim.",
  TX_NOT_FOUND: "Panta hasn't seen this transaction on-chain yet. Try again shortly.",
  TX_FAILED: "The transaction failed on-chain.",
  TX_MISMATCH: "Panta says this transaction doesn't match the expected wallet, market or program.",
  TX_FEE_MISMATCH: "Panta says the on-chain amount doesn't match the quote.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  INTERNAL_ERROR: "Panta had an internal error. Try again shortly.",
  UPSTREAM_ERROR: "Panta returned an error. Try again shortly.",
  // This app's routes / proxy
  PANTA_UNREACHABLE: "Couldn't reach Panta. Try again shortly.",
  PANTA_UPSTREAM: "Panta returned an error. Try again shortly.",
  PANTA_TRADES_MALFORMED: "Panta returned trade data in an unexpected format, so it isn't shown.",
  UPSTREAM_TIMEOUT: "Panta took too long to respond. Try again.",
  PROXY_UNREACHABLE: "Couldn't reach Panta. Try again shortly.",
  SERVER_KEY_MISSING: "This deployment isn't connected to Panta (server API key missing).",
  ROUTE_NOT_ALLOWED: "That Panta request isn't allowed from this app.",
  INVALID_PATH: "That request path isn't allowed.",
  METHOD_NOT_ALLOWED: "That request method isn't allowed.",
  CATALOG_UNAVAILABLE: "The market catalog is unavailable right now. Try again shortly.",
  BRIEF_FAILED: "The brief couldn't be generated. Try again.",
  INVALID_MARKET_ID: "That isn't a valid market id.",
  INVALID_MODE: "That brief mode isn't supported.",
  INVALID_JSON: "The request wasn't valid JSON.",
  INVALID_REQUEST: "The request was invalid.",
  INVALID_QUERY: "The request was invalid.",
  UNEXPECTED_FIELDS: "The request had unexpected fields.",
  UNSUPPORTED_MEDIA_TYPE: "The request had the wrong content type.",
  PAYLOAD_TOO_LARGE: "The request was too large.",
  INVALID_FEEDBACK: "The rating couldn't be saved: it was incomplete or invalid.",
  FEEDBACK_NOT_STORED: "The rating couldn't be saved. Try again.",
  INVALID_EVENT: "The usage event was invalid.",
  EVENT_NOT_STORED: "The usage event couldn't be stored.",
  INVALID_ATTRIBUTION_REF: "The attribution reference was invalid.",
  NOT_FOUND: "Not found.",
};

/** Codes whose upstream `message`/`detail` says what to fix, so it is shown too. */
const SHOW_DETAIL = new Set(["INVALID_MARKET_PARAMS", "AMOUNT_TOO_SMALL", "INVALID_REQUEST", "INVALID_QUERY", "UNEXPECTED_FIELDS"]);

const CODE_RE = /^[A-Z][A-Z0-9_]{2,}$/;

export function isErrorCode(s: string): boolean {
  return CODE_RE.test(s);
}

function generic(status?: number): string {
  if (status === 429) return ERROR_MESSAGES.RATE_LIMITED;
  if (status != null && status >= 500) return "The service had a problem. Try again shortly.";
  if (status === 404) return "Not found.";
  return "The request failed.";
}

/**
 * Human text for an error code (+ optional upstream detail and HTTP status).
 * Unknown codes get a generic sentence; the code is kept as a short ref.
 */
export function humanError(code: string | null | undefined, detail?: string | null, status?: number): string {
  const c = (code || "").trim();
  if (!c) return detail?.trim() || generic(status);
  const known = ERROR_MESSAGES[c] ?? (c.startsWith("PANTA_HTTP_") ? ERROR_MESSAGES.PANTA_UPSTREAM : null);
  const base = known ?? generic(status);
  const extra = SHOW_DETAIL.has(c) && detail?.trim() ? ` ${detail.trim().replace(/\.?$/, ".")}` : "";
  return `${base}${extra} (ref ${c})`;
}
