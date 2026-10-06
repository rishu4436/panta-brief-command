/**
 * In-session record of trades this tab confirmed on-chain (Stage D).
 *
 * Memory only (never persisted): a record exists only after Solana confirmed
 * the signature, and it is labelled "this session" wherever it is shown. It
 * carries what the decoded, signed transaction committed to (market, side,
 * amount) plus Panta's order-verification result, so the market page can show
 * confirmed vs verified without guessing. Positions and shares always come
 * from Panta (/positions/, tape); quoted shares are kept only as a label.
 */

import type { Position, Trade } from "@/lib/panta/domain";
import type { VerifyPhase } from "@/lib/trade-state";

export type ReconcileStatus = "pending" | "reflected" | "stale";

export type SessionTrade = {
  signature: string;
  marketId: string;
  wallet: string;
  side: "yes" | "no";
  /** USDC base units from the decoded, signed transaction. */
  amountBase: string;
  orderId: string | null;
  /** Panta's expected shares at build time (label only, never a position). */
  quotedShares: string | null;
  confirmedAt: number;
  verify: VerifyPhase;
  verifyStatus: string | null;
  /** Position shares on this side before the refresh; null = no row. */
  baselineShares: number | null;
  /** false when positions weren't loaded at confirmation time. */
  baselineKnown: boolean;
  reconcile: ReconcileStatus;
  attempts: number;
  /** Panta's market tape lists this signature. */
  tapeIndexed: boolean;
};

/** Follow-up refetches after a confirmed trade: 4 attempts, ~37.5 s total, then stop. */
export const RECONCILE_DELAYS_MS = [2500, 5000, 10000, 20000] as const;
export const RECONCILE_MAX_ATTEMPTS = RECONCILE_DELAYS_MS.length;

type Listener = () => void;
const records = new Map<string, SessionTrade>();
const listeners = new Set<Listener>();
let version = 0;
const emit = () => {
  version += 1;
  for (const l of listeners) l();
};

export const tradeSession = {
  get: (signature: string): SessionTrade | undefined => records.get(signature),
  list: (): SessionTrade[] => [...records.values()],
  version: () => version,
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** First confirmation of a signature only; false when already recorded (no duplicate loop). */
  record(t: SessionTrade): boolean {
    if (records.has(t.signature)) return false;
    records.set(t.signature, t);
    emit();
    return true;
  },
  patch(signature: string, patch: Partial<Omit<SessionTrade, "signature" | "marketId" | "wallet" | "side" | "amountBase">>): void {
    const cur = records.get(signature);
    if (!cur) return;
    records.set(signature, { ...cur, ...patch });
    emit();
  },
  /** Tests only. */
  reset(): void {
    records.clear();
    quoteFlags.clear();
    emit();
  },
};

export function sessionTradesFor(marketId: string, wallet: string | null): SessionTrade[] {
  if (!wallet) return [];
  return tradeSession
    .list()
    .filter((t) => t.marketId === marketId && t.wallet === wallet)
    .sort((a, b) => b.confirmedAt - a.confirmedAt);
}

/** Baseline before refresh: unknown when positions weren't loaded; null shares = no row. */
export function positionBaseline(
  positions: Position[] | undefined,
  marketId: string,
  side: "yes" | "no",
): { known: boolean; shares: number | null } {
  if (!positions) return { known: false, shares: null };
  const row = positions.find((p) => p.marketId === marketId && p.side === side);
  return { known: true, shares: row ? row.sharesNum : null };
}

/**
 * Has Panta caught up with this trade? Authoritative data only:
 *  - tapeIndexed: the market tape lists the signature;
 *  - positionReflected: a /positions/ row for (market, side) exists and either
 *    differs from a known baseline, or (baseline unknown) the tape already has it.
 */
export function evaluateReconcile(
  t: Pick<SessionTrade, "signature" | "marketId" | "side" | "baselineShares" | "baselineKnown">,
  positions: Position[] | undefined,
  tape: Trade[] | undefined,
): { tapeIndexed: boolean; positionReflected: boolean } {
  const tapeIndexed = Boolean(tape?.some((r) => r.signature === t.signature));
  const row = positions?.find((p) => p.marketId === t.marketId && p.side === t.side);
  let positionReflected = false;
  if (row && row.sharesNum != null) {
    positionReflected = t.baselineKnown ? row.sharesNum !== t.baselineShares : tapeIndexed;
  }
  return { tapeIndexed, positionReflected };
}

export function nextReconcileStatus(reflected: boolean, attempts: number): ReconcileStatus {
  if (reflected) return "reflected";
  return attempts >= RECONCILE_MAX_ATTEMPTS ? "stale" : "pending";
}

// ------------------------------------------------- quote availability (per market)

/** A PANTA_PRICING_UNAVAILABLE quote marks the market "quote unavailable" for this long. */
export const QUOTE_UNAVAILABLE_TTL_MS = 120_000;
const quoteFlags = new Map<string, number>();

/** Called by the ticket after each quote attempt on a market. */
export function noteQuoteAvailability(marketId: string, unavailable: boolean, now = Date.now()): void {
  const id = marketId.trim();
  if (!id) return;
  const had = quoteFlags.has(id);
  if (unavailable) quoteFlags.set(id, now);
  else quoteFlags.delete(id);
  if (had !== unavailable || unavailable) emit();
}

export function isQuoteUnavailable(marketId: string, now = Date.now()): boolean {
  const at = quoteFlags.get(marketId.trim());
  return at != null && now - at < QUOTE_UNAVAILABLE_TTL_MS;
}
