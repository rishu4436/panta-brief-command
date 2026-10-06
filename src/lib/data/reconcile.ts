"use client";

/**
 * Trade → market / position / activity reconciliation (Stage D).
 *
 * Runs only after Solana confirmed the signature. It invalidates the
 * authoritative queries, then refetches positions + tape a bounded number of
 * times until Panta reflects the trade. It never writes a position, share
 * count or price into the cache: the UI shows "refresh pending" until Panta
 * says otherwise. Failed / expired / uncertain / rejected trades never reach it.
 */

import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { Position, TapePage } from "@/lib/panta/domain";
import { canonicalMarketId } from "@/lib/panta/lifecycle";
import { fetchMarketTrades } from "@/lib/panta/markets";
import { fetchPositions } from "@/lib/panta/positions";
import type { VerifyPhase } from "@/lib/trade-state";
import { qk } from "./hooks";
import {
  RECONCILE_DELAYS_MS,
  evaluateReconcile,
  isQuoteUnavailable,
  positionBaseline,
  sessionTradesFor,
  tradeSession,
  type SessionTrade,
} from "./trade-session";

export type InvalidationStep = { queryKey: QueryKey; refetch: boolean };

/**
 * What a confirmed trade invalidates. The catalog is only marked stale (it
 * refetches on next use) so a trade never forces the heavy /api/catalog build.
 */
export function tradeInvalidationPlan(marketId: string, wallet: string): InvalidationStep[] {
  return [
    { queryKey: qk.market(marketId), refetch: true },
    { queryKey: qk.trades(marketId), refetch: true },
    { queryKey: qk.positions(wallet), refetch: true },
    { queryKey: qk.usdc(wallet), refetch: true },
    { queryKey: ["accountTrades"], refetch: true },
    { queryKey: qk.catalog(), refetch: false },
  ];
}

export type ConfirmedTradeInput = {
  signature: string;
  /** From the decoded, signed transaction (checkBuild → verified). */
  marketId: string;
  wallet: string;
  side: "yes" | "no";
  amountBase: string;
  orderId?: string | null;
  quotedShares?: string | null;
};

export type ReconcileDeps = {
  fetchPositions: (wallet: string) => Promise<Position[]>;
  fetchTrades: (marketId: string) => Promise<TapePage>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  delays?: readonly number[];
};

const defaultDeps: ReconcileDeps = {
  fetchPositions,
  fetchTrades: fetchMarketTrades,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** Record + invalidate + start the bounded follow-up. Never throws. Returns false if ignored. */
export function onTradeConfirmed(qc: QueryClient, input: ConfirmedTradeInput, deps: ReconcileDeps = defaultDeps): boolean {
  try {
    const marketId = canonicalMarketId(input.marketId);
    const wallet = canonicalMarketId(input.wallet);
    if (!marketId || !wallet || !SIG_RE.test(input.signature)) return false;
    if (input.side !== "yes" && input.side !== "no") return false;
    const baseline = positionBaseline(qc.getQueryData<Position[]>(qk.positions(wallet)), marketId, input.side);
    const rec: SessionTrade = {
      signature: input.signature,
      marketId,
      wallet,
      side: input.side,
      amountBase: input.amountBase,
      orderId: input.orderId ?? null,
      quotedShares: input.quotedShares ?? null,
      confirmedAt: deps.now(),
      verify: "idle",
      verifyStatus: null,
      baselineShares: baseline.shares,
      baselineKnown: baseline.known,
      reconcile: "pending",
      attempts: 0,
      tapeIndexed: false,
    };
    // Single flight per signature: a second confirmation (manual re-check) is a no-op.
    if (!tradeSession.record(rec)) return false;
    for (const step of tradeInvalidationPlan(marketId, wallet)) {
      void qc.invalidateQueries({ queryKey: step.queryKey, refetchType: step.refetch ? "active" : "none" });
    }
    void runTradeReconcile(qc, input.signature, deps);
    return true;
  } catch {
    return false;
  }
}

/** Bounded follow-up: at most RECONCILE_DELAYS_MS.length refetch rounds, then "stale". */
export async function runTradeReconcile(qc: QueryClient, signature: string, deps: ReconcileDeps = defaultDeps): Promise<void> {
  const delays = deps.delays ?? RECONCILE_DELAYS_MS;
  for (const delay of delays) {
    await deps.sleep(delay);
    const t = tradeSession.get(signature);
    if (!t || t.reconcile !== "pending") return;
    const positions = await qc
      .fetchQuery({ queryKey: qk.positions(t.wallet), queryFn: () => deps.fetchPositions(t.wallet), staleTime: 0 })
      .catch(() => undefined);
    const tape = await qc
      .fetchQuery({ queryKey: qk.trades(t.marketId), queryFn: () => deps.fetchTrades(t.marketId), staleTime: 0 })
      .then((p) => p.trades)
      .catch(() => undefined);
    const ev = evaluateReconcile(t, positions, tape);
    const attempts = t.attempts + 1;
    const status = ev.positionReflected ? "reflected" : attempts >= delays.length ? "stale" : "pending";
    tradeSession.patch(signature, { attempts, tapeIndexed: t.tapeIndexed || ev.tapeIndexed, reconcile: status });
    if (status !== "pending") {
      if (status === "reflected") void qc.invalidateQueries({ queryKey: qk.market(t.marketId) });
      return;
    }
  }
}

/** Panta /primaryorderverify/ result for a recorded signature (no fetch). */
export function onTradeVerify(signature: string | null | undefined, phase: VerifyPhase, status: string | null): void {
  if (!signature) return;
  try {
    tradeSession.patch(signature, { verify: phase, verifyStatus: status });
  } catch {
    /* never affects the trade flow */
  }
}

/** Ticket hook: stable callbacks bound to the shared QueryClient. */
export function useTradeReconciler() {
  const qc = useQueryClient();
  const onConfirmed = useCallback((input: ConfirmedTradeInput) => onTradeConfirmed(qc, input), [qc]);
  return { onConfirmed, onVerify: onTradeVerify };
}

/** Manual "Refresh" from the market page: one more authoritative round, no loop. */
export function useRefreshTradeState() {
  const qc = useQueryClient();
  return useCallback(
    (marketId: string, wallet: string | null) => {
      void qc.invalidateQueries({ queryKey: qk.trades(marketId) });
      void qc.invalidateQueries({ queryKey: qk.market(marketId) });
      void qc.invalidateQueries({ queryKey: ["accountTrades"] });
      if (wallet) void qc.invalidateQueries({ queryKey: qk.positions(wallet) });
    },
    [qc],
  );
}

const subscribe = (l: () => void) => tradeSession.subscribe(l);
const getVersion = () => tradeSession.version();

/** Session trades for one market + wallet (re-renders on any session change). */
export function useSessionTrades(marketId: string, wallet: string | null): SessionTrade[] {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return sessionTradesFor(marketId, wallet);
}

export function useQuoteUnavailable(marketId: string): boolean {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return isQuoteUnavailable(marketId);
}
