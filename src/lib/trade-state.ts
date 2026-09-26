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
  | "quote_ready"
  | "quote_stale"
  | "quote_expired"
  | "building"
  | "build_failed"
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
  | "attributed"
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
    explain: "Market, side or amount changed after this quote, so it no longer matches the ticket.",
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
    safe: "Your position shows in your Book.",
    action: "view_activity",
    actionLabel: "View in Book",
    step: "attribute",
    mark: "done",
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
export function classifyFailure(stage: FlowStage | null, err: unknown, opts: { presign?: boolean } = {}): TradeStateId {
  switch (stage) {
    case "quote":
      return "quote_failed";
    case "build":
      return opts.presign ? "presign_failed" : "build_failed";
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

// ---------------------------------------------------------------- quote expiry

/**
 * Fallback when a quote carries no parseable `expiresAt`. Panta documents
 * quote sessions as "~90s" (docs.panta.market, orders overview); we assume
 * 60 s so a slow review never approves a quote Panta already dropped.
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

/** Whole seconds left (never negative). */
export function secondsLeft(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- derivation

export type TxPhase = "idle" | "confirming" | "confirmed" | "pending" | "failed" | "expired";
export type VerifyPhase = "idle" | "polling" | "confirmed" | "failed" | "timeout";
export type AttrPhase = "idle" | "reporting" | "reported" | "attributed";

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
  if (s.attrPhase === "attributed") return "attributed";
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
    (s.failure === "signature_rejected" || s.failure === "sign_failed" || s.failure === "build_failed")
  ) {
    return "quote_expired";
  }
  if (s.failure) return s.failure;
  if (s.hasSignature) {
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
