/**
 * Trade-state system shared by the desk ticket and the landing execution
 * preview. Pure (no React, no network) so the mapping and the wallet-error
 * classification are unit-tested.
 *
 * Rules this encodes:
 *  - A state only advances on a real result (quote parsed, build checked,
 *    signature returned, confirmation observed, Panta verify/report status).
 *  - "Verified" needs Panta verify status `confirmed`; "Attributed" needs
 *    POST /trades/ `processed` or the signature in GET /account/trades/.
 *  - A verify that outlives its ~30 s budget is a delay, not a failure.
 */

export type StepId = "quote" | "build" | "sign" | "broadcast" | "confirm" | "verify" | "attribute";
export type StepMark = "waiting" | "active" | "done" | "failed" | "warn" | "pending";

export const STEP_ORDER: readonly StepId[] = ["quote", "build", "sign", "broadcast", "confirm", "verify", "attribute"];

export const STEP_LABEL: Record<StepId, string> = {
  quote: "Quote",
  build: "Build & check",
  sign: "Sign",
  broadcast: "Broadcast",
  confirm: "Confirm",
  verify: "Verify",
  attribute: "Attribute",
};

export type TradeStateId =
  | "disconnected"
  | "ready"
  | "quoting"
  | "quote_failed"
  | "quote_unavailable"
  | "quote_ready"
  | "quote_stale"
  | "quote_expired"
  | "building"
  | "build_failed"
  | "build_unavailable"
  | "presign_failed"
  | "review"
  | "awaiting_signature"
  | "signature_rejected"
  | "sign_failed"
  | "broadcast_failed"
  | "confirming"
  | "confirm_timeout"
  | "tx_failed"
  | "confirmed"
  | "submit_failed"
  | "verifying"
  | "verify_slow"
  | "verify_failed"
  | "reported"
  | "verified"
  | "reporting"
  | "attribution_needs_attention"
  | "attributed"
  | "attributed_unverified"
  | "closed_resolved"
  | "closed_cancelled"
  | "closed_secondary";

export type TradeTone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";
export type TradeIcon = "wallet" | "quote" | "spinner" | "clock" | "shield" | "check" | "x" | "pen" | "pause" | "lock";
export type TradeAction =
  | "connect"
  | "get_quote"
  | "refresh_quote"
  | "review"
  | "approve"
  | "retry_sign"
  | "check_confirmation"
  | "submit"
  | "recheck_verify"
  | "retry_attribution"
  | "view_activity"
  | "new_quote"
  | "go_claims"
  | "none";

export type TradeStateSpec = {
  tone: TradeTone;
  icon: TradeIcon;
  title: string;
  /** One plain sentence: what happened. */
  explain: string;
  /** What is safe / not affected. */
  safe?: string;
  action: TradeAction;
  actionLabel?: string;
  /** Stepper marks; earlier steps are `done`, later ones `waiting`. */
  step: StepId | null;
  mark: StepMark | null;
  /** Extra marks after `step` (e.g. attribution pending while verify is slow). */
  also?: Partial<Record<StepId, StepMark>>;
  /** Show the tx link (Solscan) when a signature exists. */
  txLink?: boolean;
  /** Errors interrupt; progress and success are announced politely. */
  urgent?: boolean;
};

export const TRADE_STATES: Record<TradeStateId, TradeStateSpec> = {
  disconnected: {
    tone: "neutral",
    icon: "wallet",
    title: "Wallet not connected",
    explain: "Connect a Solana wallet to get a quote. You can set the market, side and amount now.",
    safe: "Your keys never leave your wallet, and nothing is signed until you approve it there.",
    action: "connect",
    actionLabel: "Connect wallet",
    step: null,
    mark: null,
  },
  ready: {
    tone: "neutral",
    icon: "quote",
    title: "Ready to quote",
    explain: "Get a quote to see shares, average price and the fee before anything is built.",
    safe: "Quoting does not move funds or open your wallet.",
    action: "get_quote",
    actionLabel: "Get quote",
    step: null,
    mark: null,
  },
  quoting: {
    tone: "progress",
    icon: "spinner",
    title: "Getting a quote",
    explain: "Panta is simulating the fill and fee for this amount.",
    safe: "No funds move while quoting.",
    action: "none",
    step: "quote",
    mark: "active",
  },
  quote_failed: {
    tone: "danger",
    icon: "x",
    title: "Couldn't get a quote",
    explain: "Panta did not return a usable quote for these inputs.",
    safe: "Nothing was built or signed, and no funds moved.",
    action: "get_quote",
    actionLabel: "Try again",
    step: "quote",
    mark: "failed",
    urgent: true,
  },
  // Expected, transient Panta refusal (INVALID_MARKET_PARAMS on a valid
  // request, still there after the bounded retry in orders.ts). Not the
  // user's inputs, not a bug: say so, and offer the same action again.
  quote_unavailable: {
    tone: "warning",
    icon: "clock",
    title: "Panta couldn't price this right now",
    explain:
      "Panta briefly refuses some valid quote requests in short bursts. The ticket retried 4 times over a few seconds and Panta was still refusing.",
    safe: "Your inputs are fine. Nothing was built or signed, and no funds moved. Try again in a few seconds.",
    action: "get_quote",
    actionLabel: "Try again",
    step: "quote",
    mark: "warn",
  },
  quote_ready: {
    tone: "info",
    icon: "quote",
    title: "Quote ready",
    explain: "Check shares, average price and fee, then review the transaction before your wallet opens.",
    safe: "Nothing is signed yet. Quotes are short-lived and expire on their own.",
    action: "review",
    actionLabel: "Review & confirm",
    step: "quote",
    mark: "done",
  },
  quote_stale: {
    tone: "warning",
    icon: "pause",
    title: "Inputs changed",
    explain: "Market, side, amount or wallet changed after this quote, so it no longer matches the ticket.",
    safe: "Nothing was signed and no funds moved.",
    action: "refresh_quote",
    actionLabel: "Get a new quote",
    step: "quote",
    mark: "warn",
  },
  quote_expired: {
    tone: "warning",
    icon: "clock",
    title: "Quote expired",
    explain: "Quotes are short-lived so the price stays current; this one ran out before approval.",
    safe: "Nothing was signed and no funds moved. Approval is blocked until you refresh.",
    action: "refresh_quote",
    actionLabel: "Refresh quote",
    step: "quote",
    mark: "warn",
    urgent: true,
  },
  building: {
    tone: "progress",
    icon: "spinner",
    title: "Building and checking",
    explain: "Panta is building the transaction; we check the fee payer, signers and program allowlist before your wallet sees it.",
    safe: "Nothing is signed yet.",
    action: "none",
    step: "build",
    mark: "active",
  },
  build_failed: {
    tone: "danger",
    icon: "x",
    title: "Couldn't build the transaction",
    explain: "Panta did not return a transaction for this quote.",
    safe: "Nothing was signed and no funds moved.",
    action: "refresh_quote",
    actionLabel: "Get a new quote",
    step: "build",
    mark: "failed",
    urgent: true,
  },
  build_unavailable: {
    tone: "warning",
    icon: "clock",
    title: "Panta couldn't build this right now",
    explain:
      "Panta briefly refuses some valid build requests in short bursts. The ticket retried 4 times over a few seconds with the same quote and Panta was still refusing.",
    safe: "Nothing was signed and no funds moved. Your quote is kept; the next build gets every pre-sign check again.",
    action: "review",
    actionLabel: "Try again",
    step: "build",
    mark: "warn",
  },
  presign_failed: {
    tone: "danger",
    icon: "shield",
    title: "Safety check blocked this transaction",
    explain: "The built transaction failed the pre-sign check, so it was never sent to your wallet.",
    safe: "Nothing was signed and no funds moved.",
    action: "new_quote",
    actionLabel: "Start over",
    step: "build",
    mark: "failed",
    urgent: true,
  },
  review: {
    tone: "info",
    icon: "shield",
    title: "Review before you sign",
    explain: "The transaction passed the pre-sign check. Your wallet opens only when you approve.",
    safe: "Nothing is sent until you approve it in your wallet.",
    action: "approve",
    actionLabel: "Approve in wallet",
    step: "build",
    mark: "done",
  },
  awaiting_signature: {
    tone: "progress",
    icon: "pen",
    title: "Waiting for your wallet",
    explain: "Approve or reject the transaction in your wallet window.",
    safe: "Rejecting is safe: nothing is sent without your approval.",
    action: "none",
    step: "sign",
    mark: "active",
  },
  signature_rejected: {
    tone: "warning",
    icon: "x",
    title: "Signature rejected",
    explain: "You declined the request in your wallet, so the transaction was not sent.",
    safe: "No funds moved. The quote stays usable until it expires.",
    action: "retry_sign",
    actionLabel: "Try signing again",
    step: "sign",
    mark: "warn",
  },
  sign_failed: {
    tone: "danger",
    icon: "x",
    title: "Wallet couldn't sign",
    explain: "The wallet returned an error before the signature was produced.",
    safe: "Nothing was sent and no funds moved.",
    action: "retry_sign",
    actionLabel: "Try again",
    step: "sign",
    mark: "failed",
    urgent: true,
  },
  broadcast_failed: {
    tone: "danger",
    icon: "x",
    title: "Transaction wasn't accepted",
    explain: "The network rejected the signed transaction before it was sent (preflight or RPC error).",
    safe: "No signature came back, so there is nothing on-chain to track. Start again with a fresh quote.",
    action: "new_quote",
    actionLabel: "Start over",
    step: "broadcast",
    mark: "failed",
    urgent: true,
  },
  confirming: {
    tone: "progress",
    icon: "spinner",
    title: "Confirming on Solana",
    explain: "The transaction was sent; waiting for the network to confirm it.",
    safe: "Don't sign again: this transaction is already being tracked.",
    action: "none",
    step: "confirm",
    mark: "active",
    txLink: true,
  },
  confirm_timeout: {
    tone: "warning",
    icon: "clock",
    title: "Not confirmed yet",
    explain: "The network hasn't confirmed it within our wait window; it can still land until its blockhash expires.",
    safe: "Don't buy again, which could fill twice. Check the same transaction instead.",
    action: "check_confirmation",
    actionLabel: "Check again",
    step: "confirm",
    mark: "pending",
    txLink: true,
  },
  tx_failed: {
    tone: "danger",
    icon: "x",
    title: "Transaction didn't land",
    explain: "It failed on-chain or its blockhash expired before confirmation.",
    safe: "No shares were bought. A failed transaction can still cost a small network fee.",
    action: "new_quote",
    actionLabel: "Start over with a new quote",
    step: "confirm",
    mark: "failed",
    txLink: true,
    urgent: true,
  },
  confirmed: {
    tone: "info",
    icon: "check",
    title: "Confirmed on Solana",
    explain: "The transaction is confirmed on-chain. Next, Panta verifies the order.",
    safe: "Your trade is on-chain. Don't buy again.",
    action: "submit",
    actionLabel: "Submit to Panta",
    step: "confirm",
    mark: "done",
    txLink: true,
  },
  submit_failed: {
    tone: "warning",
    icon: "pause",
    title: "Panta didn't take the submission",
    explain: "The transaction is confirmed on Solana, but sending its signature to Panta failed.",
    safe: "Your trade is on-chain; this only affects Panta's tracking. Don't buy again.",
    action: "submit",
    actionLabel: "Retry submit",
    step: "verify",
    mark: "warn",
    txLink: true,
  },
  verifying: {
    tone: "progress",
    icon: "spinner",
    title: "Verifying with Panta",
    explain: "The transaction is confirmed on-chain; Panta is checking the order and its attribution.",
    safe: "Your trade is on-chain. You don't need to do anything.",
    action: "none",
    step: "verify",
    mark: "active",
    txLink: true,
  },
  verify_slow: {
    tone: "info",
    icon: "clock",
    title: "Still verifying — reported for attribution",
    explain: "Panta hasn't confirmed the order within 30 s. The trade was reported and appears in Activity once attributed.",
    safe: "Your transaction is confirmed on Solana. This is a delay, not a failure.",
    action: "recheck_verify",
    actionLabel: "Check again",
    step: "verify",
    mark: "pending",
    also: { attribute: "pending" },
    txLink: true,
  },
  verify_failed: {
    tone: "danger",
    icon: "x",
    title: "Panta couldn't verify the order",
    explain: "Panta returned the order as failed or expired, or rejected the verify request.",
    safe: "Check the transaction on Solscan before trying again. Don't buy twice.",
    action: "recheck_verify",
    actionLabel: "Retry verification",
    step: "verify",
    mark: "failed",
    txLink: true,
    urgent: true,
  },
  reporting: {
    tone: "progress",
    icon: "spinner",
    title: "Reporting attribution",
    explain: "Your trade is verified on-chain; the ticket is reporting it to Panta for attribution.",
    safe: "Reporting does not move funds or sign a transaction.",
    action: "none",
    step: "attribute",
    mark: "active",
    txLink: true,
  },
  // Verified trade whose POST /trades/ kept getting Panta's transient
  // INVALID_MARKET_PARAMS after the bounded retry. Never a trade failure.
  attribution_needs_attention: {
    tone: "warning",
    icon: "clock",
    title: "Needs attention",
    explain:
      "Your trade is already verified on-chain. Attribution is temporarily unavailable: Panta refused the report several times in a row.",
    safe: "Retrying attribution does not move funds or sign a transaction. It re-sends the same report for this trade.",
    action: "retry_attribution",
    actionLabel: "Retry attribution",
    step: "attribute",
    mark: "warn",
    txLink: true,
  },
  reported: {
    tone: "info",
    icon: "clock",
    title: "Reported for attribution",
    explain: "The trade was reported to Panta but the order hasn't been verified yet.",
    safe: "Your transaction is confirmed on Solana. It shows in Activity once attributed.",
    action: "recheck_verify",
    actionLabel: "Verify now",
    step: "attribute",
    mark: "pending",
    also: { verify: "waiting" },
    txLink: true,
  },
  verified: {
    tone: "success",
    icon: "check",
    title: "Verified by Panta · attribution pending",
    explain: "Panta confirmed the order. The trade was reported and will show in Activity once attributed.",
    safe: "Your position is on-chain.",
    action: "view_activity",
    actionLabel: "Open Activity",
    step: "verify",
    mark: "done",
    also: { attribute: "pending" },
    txLink: true,
  },
  attributed: {
    tone: "success",
    icon: "check",
    title: "Verified and attributed",
    explain: "Panta confirmed the order and attributed the trade to this app.",
    safe: "Your position appears in your Book once Panta indexes it.",
    action: "view_activity",
    actionLabel: "View in Book",
    step: "attribute",
    mark: "done",
    txLink: true,
  },
  attributed_unverified: {
    tone: "info",
    icon: "clock",
    title: "Attributed · Panta verification pending",
    explain: "The trade is confirmed on Solana and attributed to this app, but Panta hasn't verified the order yet.",
    safe: "Your transaction is confirmed on Solana. This is a delay, not a failure.",
    action: "recheck_verify",
    actionLabel: "Check again",
    step: "attribute",
    mark: "done",
    also: { verify: "pending" },
    txLink: true,
  },
  closed_resolved: {
    tone: "neutral",
    icon: "lock",
    title: "Market resolved",
    explain: "Trading has ended for this market.",
    safe: "If you hold a winning position, you can claim it from your Book.",
    action: "go_claims",
    actionLabel: "Go to claims",
    step: null,
    mark: null,
  },
  closed_cancelled: {
    tone: "neutral",
    icon: "lock",
    title: "Market cancelled",
    explain: "This market was cancelled, so no trading is possible.",
    safe: "Check your Book for anything claimable.",
    action: "go_claims",
    actionLabel: "Go to claims",
    step: null,
    mark: null,
  },
  closed_secondary: {
    tone: "neutral",
    icon: "lock",
    title: "Primary buys are closed",
    explain: "This market is in its secondary phase; Brief Command routes primary buys only.",
    safe: "There is nothing to quote here.",
    action: "none",
    step: null,
    mark: null,
  },
};

/** Stepper marks for a state: steps before its step are done, later ones waiting. */
export function stepMarksFor(id: TradeStateId): Record<StepId, StepMark> {
  const spec = TRADE_STATES[id];
  const idx = spec.step ? STEP_ORDER.indexOf(spec.step) : -1;
  const out = {} as Record<StepId, StepMark>;
  STEP_ORDER.forEach((s, i) => {
    out[s] = idx < 0 ? "waiting" : i < idx ? "done" : i === idx ? (spec.mark ?? "waiting") : "waiting";
  });
  if (spec.also) Object.assign(out, spec.also);
  return out;
}

// ---------------------------------------------------------------- wallet errors

/**
 * Messages wallets use when the user declines (Phantom, Solflare, Backpack,
 * Glow, Ledger via adapters). Deliberately narrow: a generic signing error is
 * NOT a rejection.
 */
const REJECT_RE =
  /user rejected|rejected the request|request rejected|rejected by (?:the )?user|user denied|denied by (?:the )?user|user declined|declined by (?:the )?user|user cancel+ed|cancel+ed by (?:the )?user|approval denied|transaction cancel+ed|request was cancel+ed|user aborted/i;

/** EIP-1193 style code that Solana wallets reuse for "user rejected". */
export const USER_REJECTED_CODE = 4001;

type ErrLike = { name?: unknown; message?: unknown; code?: unknown; error?: unknown; cause?: unknown };

/**
 * True only when the wallet says the user declined. Handles the wallet
 * adapter's `WalletSignTransactionError` wrapper (original on `.error`) and
 * `cause` chains. A `WalletSignTransactionError` without a rejection code or
 * message is a sign failure, not a rejection.
 */
export function isUserRejection(err: unknown, depth = 0): boolean {
  if (err == null || depth > 4) return false;
  if (typeof err === "string") return REJECT_RE.test(err);
  if (typeof err !== "object") return false;
  const e = err as ErrLike;
  if (e.code === USER_REJECTED_CODE || e.code === String(USER_REJECTED_CODE) || e.code === "ACTION_REJECTED") return true;
  if (typeof e.message === "string" && REJECT_RE.test(e.message)) return true;
  return isUserRejection(e.error, depth + 1) || isUserRejection(e.cause, depth + 1);
}

/** Pipeline stage that was running when something threw. */
export type FlowStage = "quote" | "build" | "sign" | "broadcast" | "confirm" | "submit" | "verify" | "attribute";

/** Map a thrown error to the failure state for the stage it came from. */
/** Body code of an API error (duck-typed: this module stays network-free). */
export function apiErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const body = (err as { body?: unknown }).body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const c = (body as { code?: unknown }).code;
  return typeof c === "string" ? c : null;
}

/** orders.ts withPantaRetry's code once Panta's transient refusal outlived every attempt. */
export const PRICING_UNAVAILABLE_CODE = "PANTA_PRICING_UNAVAILABLE";

export function isPricingUnavailable(err: unknown): boolean {
  return apiErrorCode(err) === PRICING_UNAVAILABLE_CODE;
}

export function classifyFailure(stage: FlowStage | null, err: unknown, opts: { presign?: boolean } = {}): TradeStateId {
  switch (stage) {
    case "quote":
      return isPricingUnavailable(err) ? "quote_unavailable" : "quote_failed";
    case "build":
      if (opts.presign) return "presign_failed";
      return isPricingUnavailable(err) ? "build_unavailable" : "build_failed";
    case "sign":
      if (opts.presign) return "presign_failed";
      return isUserRejection(err) ? "signature_rejected" : "sign_failed";
    case "broadcast":
      // Some adapters sign-and-send; a rejection can surface here too.
      return isUserRejection(err) ? "signature_rejected" : "broadcast_failed";
    case "confirm":
      return "confirm_timeout";
    case "submit":
      return "submit_failed";
    case "verify":
      return "verify_failed";
    case "attribute":
      // Reporting is another hand-off to Panta; the trade itself is on-chain.
      return "submit_failed";
    default:
      return isUserRejection(err) ? "signature_rejected" : "quote_failed";
  }
}

/**
 * Whether a trade failure belongs in the browser console. Expected outcomes
 * that the ticket already explains as state stay out of it: the wallet
 * declining, a quote that ran out, Panta's transient pricing refusal after
 * the retries, rate limiting, and Panta's documented business refusals for
 * the inputs. Everything else — malformed responses, failed pre-sign
 * validation, 5xx / network errors after retries, unknown codes, programming
 * errors — is logged with console.error so it stays visible.
 */
const EXPECTED_PANTA_CODES = new Set([
  PRICING_UNAVAILABLE_CODE,
  "RATE_LIMITED",
  "QUOTE_EXPIRED",
  "QUOTE_STALE",
  "AMOUNT_TOO_SMALL",
  "MARKET_NOT_IN_PRIMARY",
  "MARKET_NOT_FOUND",
  "PREVIEW_READ_ONLY",
]);

export function failureConsoleLevel(kind: TradeStateId, err: unknown): "none" | "error" {
  if (err && typeof err === "object" && (err as { name?: unknown }).name === "AbortError") return "none";
  if (kind === "signature_rejected" || kind === "quote_expired" || kind === "quote_unavailable" || kind === "build_unavailable") {
    return "none";
  }
  const status = err && typeof err === "object" ? (err as { status?: unknown }).status : undefined;
  if (typeof status === "number" && status >= 500) return "error";
  const code = apiErrorCode(err);
  if (code && EXPECTED_PANTA_CODES.has(code)) return "none";
  return "error";
}

// ---------------------------------------------------------------- quote expiry

/**
 * Fallback when a quote carries no parseable `expiresAt`. Live quotes always
 * carried one (3 Oct 2026: expiresAt was 139 s after the response's Date
 * header, longer than the "~90s" the docs list as a typical TTL), so the
 * ticket's clock and copy come from Panta's value; this conservative 60 s is
 * only for a quote without it, so a slow review never approves a quote Panta
 * already dropped.
 */
export const QUOTE_FALLBACK_TTL_MS = 60_000;
/** Treat Panta's own expiry as reached this much early (client clock skew, build time). */
export const QUOTE_EXPIRY_MARGIN_MS = 5_000;

export function quoteDeadline(
  expiresAt: string | null | undefined,
  receivedAtMs: number,
): { deadlineMs: number; source: "panta" | "fallback" } {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isFinite(t)) return { deadlineMs: t - QUOTE_EXPIRY_MARGIN_MS, source: "panta" };
  return { deadlineMs: receivedAtMs + QUOTE_FALLBACK_TTL_MS, source: "fallback" };
}

export const QUOTE_FALLBACK_NOTE = `Panta sent no expiry time, so this ticket assumes a conservative ${QUOTE_FALLBACK_TTL_MS / 1000} s.`;

/**
 * Expiry copy for the ticket, derived from what Panta actually sent (never a
 * hardcoded TTL): the expiry time in IST, how long after receipt that was,
 * and the safety margin the ticket applies.
 */
export function quoteExpiryNote(expiresAt: string | null | undefined, receivedAtMs: number): string {
  const d = quoteDeadline(expiresAt, receivedAtMs);
  if (d.source === "fallback") return QUOTE_FALLBACK_NOTE;
  const t = Date.parse(expiresAt as string);
  const at = new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Calcutta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const ttl = Math.round((t - receivedAtMs) / 1000);
  const life = ttl > 0 ? ` (${ttl} s after it arrived)` : " (already past when it arrived)";
  return `Panta set this quote to expire at ${at} IST${life}; the ticket stops ${QUOTE_EXPIRY_MARGIN_MS / 1000} s early.`;
}

/** Whole seconds left (never negative). */
export function secondsLeft(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- quote vs inputs

/**
 * The single stale-quote rule, shared by Guided and Step-by-step and run
 * immediately before build AND before sign (and for the UI state).
 *
 * A quote is bound to the market, side, amount and wallet it was requested
 * with, and to its deadline. A build is additionally bound to the slippage
 * cap and wallet it was built with. Anything else → stop; nothing may be
 * sent to the wallet.
 */
export type QuoteStaleReason =
  | "no_quote"
  | "expired"
  | "market_changed"
  | "side_changed"
  | "amount_changed"
  | "amount_invalid"
  | "wallet_changed"
  | "slippage_changed"
  | "slippage_invalid"
  | "build_wallet_mismatch";

export type QuoteGuardResult =
  | { ok: true }
  | { ok: false; reason: QuoteStaleReason; message: string; fix: "new_quote" | "rebuild" | "reconnect" };

export type QuotedOrder = {
  marketId: string;
  side?: string | null;
  amountUsdc: string;
  expiresAt?: string | null;
};

export type TicketInputs = {
  marketId: string;
  side: string;
  /** null when the amount input is currently invalid. */
  amountUsdc: string | null;
  /** Connected wallet (base58), null when disconnected. */
  wallet: string | null;
  /** null when the slippage input is currently invalid. */
  slippageBps?: number | null;
};

/** What the quote / build were made with (recorded by the ticket). */
export type QuoteBinding = {
  /** Wallet the quote was requested for. */
  wallet: string;
  /** ms when the quote arrived (for the fallback TTL). */
  receivedAtMs: number;
};
export type BuildBinding = { wallet: string; slippageBps: number; buildWallet?: string | null };

const STALE_MSG: Record<QuoteStaleReason, string> = {
  no_quote: "Get a quote first.",
  expired: "Quote expired. Get a new quote before signing.",
  market_changed: "Market changed since this quote. Get a new quote.",
  side_changed: "Side changed since this quote. Get a new quote.",
  amount_changed: "Amount changed since this quote. Get a new quote.",
  amount_invalid: "Amount is no longer valid. Fix it and get a new quote.",
  wallet_changed: "Connected wallet changed since this quote. Get a new quote for this wallet.",
  slippage_changed: "Max slippage changed since this order was built. Review again to rebuild it.",
  slippage_invalid: "Max slippage is not valid. Fix it before continuing.",
  build_wallet_mismatch: "This order was built for a different wallet. It cannot be signed by the connected wallet.",
};

const stale = (reason: QuoteStaleReason, fix: "new_quote" | "rebuild" | "reconnect"): QuoteGuardResult => ({
  ok: false,
  reason,
  message: STALE_MSG[reason],
  fix,
});

export function quoteGuard(
  quote: QuotedOrder | null,
  binding: QuoteBinding | null,
  inputs: TicketInputs,
  nowMs: number,
  build?: BuildBinding | null,
): QuoteGuardResult {
  if (!quote || !binding) return stale("no_quote", "new_quote");
  if (quote.marketId !== inputs.marketId.trim()) return stale("market_changed", "new_quote");
  if (quote.side && quote.side !== inputs.side) return stale("side_changed", "new_quote");
  if (inputs.amountUsdc == null) return stale("amount_invalid", "new_quote");
  if (Number(quote.amountUsdc) !== Number(inputs.amountUsdc)) return stale("amount_changed", "new_quote");
  if (!inputs.wallet || inputs.wallet !== binding.wallet) return stale("wallet_changed", "new_quote");
  if (nowMs >= quoteDeadline(quote.expiresAt, binding.receivedAtMs).deadlineMs) return stale("expired", "new_quote");
  if (build) {
    if (build.wallet !== inputs.wallet || (build.buildWallet && build.buildWallet !== inputs.wallet)) {
      return stale("build_wallet_mismatch", "new_quote");
    }
    if (inputs.slippageBps == null) return stale("slippage_invalid", "rebuild");
    if (inputs.slippageBps !== build.slippageBps) return stale("slippage_changed", "rebuild");
  }
  return { ok: true };
}

/** Reasons that mean the quote no longer describes the ticket (UI "Inputs changed"). */
export const INPUT_STALE_REASONS: ReadonlySet<QuoteStaleReason> = new Set([
  "market_changed",
  "side_changed",
  "amount_changed",
  "amount_invalid",
  "wallet_changed",
]);

/**
 * True when the ticket inputs no longer describe the quoted order (market,
 * side, amount or wallet changed, or the amount is no longer valid). Thin
 * view over quoteGuard for the UI state; expiry is reported separately.
 */
export function isQuoteStale(
  quote: { marketId: string; side?: string | null; amountUsdc: string } | null,
  inputs: { marketId: string; side: string; amountUsdc: string | null; wallet?: string | null },
  quoteWallet?: string | null,
): boolean {
  if (!quote) return false;
  // Wallet is compared only when the caller supplies both sides.
  const checkWallet = inputs.wallet !== undefined && quoteWallet !== undefined;
  const w = checkWallet ? (inputs.wallet ?? null) : "-";
  const g = quoteGuard(
    { ...quote, expiresAt: null },
    { wallet: checkWallet ? (quoteWallet ?? "") : "-", receivedAtMs: 0 },
    { ...inputs, wallet: w },
    0,
  );
  return !g.ok && INPUT_STALE_REASONS.has(g.reason);
}

// ---------------------------------------------------------------- derivation

export type TxPhase = "idle" | "confirming" | "confirmed" | "pending" | "failed" | "expired";
export type VerifyPhase = "idle" | "polling" | "confirmed" | "failed" | "timeout";
/** needs_attention: verified trade, attribution report refused (transient) after every retry. */
export type AttrPhase = "idle" | "reporting" | "reported" | "attributed" | "needs_attention";

export type TradeSnapshot = {
  connected: boolean;
  closed?: "resolved" | "cancelled" | "secondary" | null;
  /** Stage currently running, or null when idle. */
  running: FlowStage | null;
  /** Last classified failure (cleared when a new action starts). */
  failure: TradeStateId | null;
  hasQuote: boolean;
  quoteExpired: boolean;
  quoteStale: boolean;
  hasBuild: boolean;
  presignOk: boolean;
  reviewOpen: boolean;
  hasSignature: boolean;
  txPhase: TxPhase;
  verifyPhase: VerifyPhase;
  attrPhase: AttrPhase;
};

const RUNNING_STATE: Record<FlowStage, TradeStateId> = {
  quote: "quoting",
  build: "building",
  sign: "awaiting_signature",
  broadcast: "confirming",
  confirm: "confirming",
  submit: "verifying",
  verify: "verifying",
  attribute: "verifying",
};

/** Single source of truth for which state the ticket is in. */
export function deriveTradeState(s: TradeSnapshot): TradeStateId {
  if (s.closed) return s.closed === "resolved" ? "closed_resolved" : s.closed === "cancelled" ? "closed_cancelled" : "closed_secondary";
  // Attribution alone is not Panta verification: "Verified" needs verifyPhase confirmed.
  if (s.attrPhase === "attributed") {
    if (s.verifyPhase === "confirmed") return "attributed";
    if (s.verifyPhase === "failed") return "verify_failed";
    if (s.running === "verify") return "verifying";
    return "attributed_unverified";
  }
  // Reporting a verified trade: Verify stays completed, Attribute is active.
  if (s.running === "attribute" && s.verifyPhase === "confirmed") return "reporting";
  if (s.running) return RUNNING_STATE[s.running];
  // On-chain outcome beats the stage-level classification (a confirm-stage
  // throw is a timeout only when the tx did not fail or expire).
  if (s.hasSignature && (s.txPhase === "failed" || s.txPhase === "expired")) return "tx_failed";
  // A retry-able pre-send failure on a quote that has since expired: the only
  // honest next step is a fresh quote.
  if (
    s.failure &&
    !s.hasSignature &&
    s.hasQuote &&
    s.quoteExpired &&
    (s.failure === "signature_rejected" ||
      s.failure === "sign_failed" ||
      s.failure === "build_failed" ||
      s.failure === "build_unavailable")
  ) {
    return "quote_expired";
  }
  if (s.failure) return s.failure;
  if (s.hasSignature) {
    if (s.attrPhase === "needs_attention" && s.txPhase === "confirmed") return "attribution_needs_attention";
    if (s.attrPhase === "reporting" && s.verifyPhase === "confirmed") return "reporting";
    if (s.txPhase === "pending") return "confirm_timeout";
    if (s.txPhase === "confirming") return "confirming";
    if (s.verifyPhase === "timeout") return "verify_slow";
    if (s.verifyPhase === "confirmed") return "verified";
    if (s.verifyPhase === "polling" || s.attrPhase === "reporting") return "verifying";
    if (s.attrPhase === "reported") return "reported";
    if (s.txPhase === "confirmed") return "confirmed";
  }
  if (!s.connected) return "disconnected";
  if (s.hasQuote) {
    if (s.quoteStale) return "quote_stale";
    if (s.quoteExpired) return "quote_expired";
    if (s.reviewOpen || (s.hasBuild && s.presignOk)) return "review";
    return "quote_ready";
  }
  return "ready";
}
