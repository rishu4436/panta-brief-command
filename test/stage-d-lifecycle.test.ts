/**
 * Stage D: unified market lifecycle (docs/MARKET_LIFECYCLE.md).
 * Regression evidence: live France–Belgium market + test wallet 41Vs… (fixture only).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { applyChainEvent, selectMergedMarket } from "@/lib/panta/catalog";
import type { ChainEvent } from "@/lib/panta/chain-events";
import type { Market, Position, TapePage, Trade } from "@/lib/panta/domain";
import { mergeMarket, parseMarket, parseTradesDetailed } from "@/lib/panta/markets";
import { parsePositions } from "@/lib/panta/positions";
import { parseAccountTrades } from "@/lib/panta/attribution";
import { marketProbability } from "@/lib/panta/prices";
import {
  canonicalMarketId,
  isMarketNotFound,
  isPantaIndexed,
  marketHref,
  marketState,
} from "@/lib/panta/lifecycle";
import { buildMarketActivity } from "@/lib/panta/market-activity";
import {
  CREATED_MARKETS_KEY,
  awaitingIndexing,
  createdMarketsStore,
  needsRegistration,
  parseCreatedMarkets,
} from "@/lib/panta/created-markets";
import type { CreateRecoveryRecord } from "@/lib/panta/create-recovery";
import { enrichPosition } from "@/lib/panta/position-intel";
import {
  RECONCILE_DELAYS_MS,
  evaluateReconcile,
  isQuoteUnavailable,
  noteQuoteAvailability,
  positionBaseline,
  sessionTradesFor,
  tradeSession,
  type SessionTrade,
} from "@/lib/data/trade-session";
import { onTradeConfirmed, onTradeVerify, runTradeReconcile, tradeInvalidationPlan } from "@/lib/data/reconcile";
import { qk } from "@/lib/data/hooks";
import { deriveTradeState, type TradeSnapshot } from "@/lib/trade-state";

const FX = JSON.parse(readFileSync(new URL("./fixtures/stage-d-france-belgium.live-2026-10-06.json", import.meta.url), "utf8"));
const FB_ID = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";
const WALLET = "41VsShZb5VTKCxRRiGq11GF6foLBVpLocjytBbQmYaGZ";
const OTHER_WALLET = "11111111111111111111111111111111";
const OTHER_MARKET = "6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd";
const SIG = (c: string) => c.repeat(88).slice(0, 88);
const NOW = 1_791_000_000; // before France–Belgium end time

const market = (over: Partial<Market> = {}): Market => ({
  marketId: FB_ID,
  title: "France vs Belgium",
  category: "sports",
  phase: "primary",
  status: "primary",
  endTime: NOW + 86_400,
  primaryPhaseEndTime: NOW + 3_600,
  yesPrice: "0.5",
  noPrice: "0.5",
  ...over,
});

beforeEach(() => tradeSession.reset());

// ---------------------------------------------------------------- adapter

describe("canonical market adapter", () => {
  it("parses the live resolved France–Belgium record with Panta's outcome", () => {
    const m = parseMarket(FX.market)!;
    expect(m.marketId).toBe(FB_ID);
    expect(m.resolved).toBe(true);
    expect(m.outcome).toBe("no"); // yesWins: false
    const s = marketState({ marketId: FB_ID, market: m, now: NOW + 10 ** 7 });
    expect(s.kind).toBe("resolved");
    expect(s.label).toBe("Resolved · NO");
    expect(s.tradableHere).toBe(false);
  });
  it("missing optional fields stay undefined/null, never zero", () => {
    const m = parseMarket({ marketId: FB_ID, title: "x" })!;
    expect(m.yesPrice).toBeNull();
    expect(m.noPrice).toBeNull();
    expect(m.volumeUsdc).toBeUndefined();
    expect(m.outcome).toBeUndefined();
    const px = marketProbability(m);
    expect(px.yes).toBeNull();
    expect(px.no).toBeNull();
    expect(px.reason).not.toBeNull();
  });
  it("a genuine zero price is kept as \"0\" (not null)", () => {
    const m = parseMarket({ ...FX.market })!;
    expect(m.yesPrice).toBe("0");
    expect(m.noPrice).toBe("1");
  });
  it("outcome only when Panta says resolved (yesWins on an unresolved market is ignored)", () => {
    expect(parseMarket({ marketId: FB_ID, resolved: false, yesWins: true })!.outcome).toBeUndefined();
    expect(parseMarket({ marketId: FB_ID, yesWins: true })!.outcome).toBeUndefined();
    expect(parseMarket({ marketId: FB_ID, resolved: true, yesWins: true })!.outcome).toBe("yes");
  });
  it("malformed records are rejected", () => {
    expect(parseMarket({ title: "no id" })).toBeNull();
    expect(parseMarket(null)).toBeNull();
    expect(canonicalMarketId("not a market id!")).toBeNull();
    expect(canonicalMarketId(42)).toBeNull();
    expect(canonicalMarketId(` ${FB_ID} `)).toBe(FB_ID);
  });
  it("mergeMarket carries the outcome and keeps one-way resolution", () => {
    const list = market({ resolved: true, phase: "resolved", status: "resolved", outcome: "no", sources: { list: true, chain: true, detail: false } });
    const detail = market({ resolved: false, phase: "primary", partial: true });
    const merged = mergeMarket(list, detail);
    expect(merged.resolved).toBe(true);
    expect(merged.outcome).toBe("no");
  });
  it("on-chain Event outcome only once resolved", () => {
    const ev = { marketId: FB_ID, question: "q", resolutionRule: "", oracle: "", startTime: 1, endTime: 2, resolutionTime: 3, createdAt: 1, resolvedAt: 0, cancelledAt: 0, primaryPhaseEndTime: null, lastYesPrice: null, totalVolumeBase: "0", activeVolumeBase: "0", totalTrades: 0, isActive: true, isGraduated: false, isResolved: false, isCancelled: false, yesWins: true } satisfies ChainEvent;
    expect(applyChainEvent(undefined, ev).outcome).toBeUndefined();
    expect(applyChainEvent(undefined, { ...ev, isResolved: true, yesWins: false }).outcome).toBe("no");
  });
});

// ---------------------------------------------------------------- lifecycle states

describe("lifecycle states", () => {
  it("active primary is tradable here; secondary is active but not tradable here", () => {
    expect(marketState({ marketId: FB_ID, market: market(), now: NOW })).toMatchObject({ kind: "active", tradableHere: true, lifecycle: "open" });
    expect(marketState({ marketId: FB_ID, market: market({ phase: "secondary", status: "secondary" }), now: NOW })).toMatchObject({ kind: "active", tradableHere: false, lifecycle: "trading" });
  });
  it("expiry alone gives closed, never resolved", () => {
    const s = marketState({ marketId: FB_ID, market: market({ endTime: NOW - 1 }), now: NOW });
    expect(s.kind).toBe("closed");
    expect(s.outcome).toBeNull();
  });
  it("cancelled and unknown phases are distinct and not tradable", () => {
    expect(marketState({ marketId: FB_ID, market: market({ phase: "cancelled" }), now: NOW }).kind).toBe("cancelled");
    expect(marketState({ marketId: FB_ID, market: market({ phase: "weird", status: "weird" }), now: NOW })).toMatchObject({ kind: "unknown", tradableHere: false });
  });
  it("quote unavailable ≠ closed and ≠ 0 %", () => {
    const s = marketState({ marketId: FB_ID, market: market(), quoteUnavailable: true, now: NOW });
    expect(s.kind).toBe("quote_unavailable");
    expect(s.lifecycle).toBe("open");
    expect(s.detail).toMatch(/isn't a 0 % price/);
  });
  it("API failure ≠ closed / resolved; not found is its own state", () => {
    const api = marketState({ marketId: FB_ID, market: null, error: new Error("upstream 502") });
    expect(api).toMatchObject({ kind: "unavailable", reason: "api_error" });
    const nf = new Error("MARKET_NOT_FOUND");
    expect(isMarketNotFound(nf)).toBe(true);
    expect(marketState({ marketId: FB_ID, market: null, error: nf, notFound: true })).toMatchObject({ kind: "unavailable", reason: "not_found" });
    expect(marketState({ marketId: FB_ID, market: null, loading: true }).kind).toBe("loading");
  });
  it("quote availability flag is per market and expires", () => {
    noteQuoteAvailability(FB_ID, true, 1000);
    expect(isQuoteUnavailable(FB_ID, 2000)).toBe(true);
    expect(isQuoteUnavailable(OTHER_MARKET, 2000)).toBe(false);
    expect(isQuoteUnavailable(FB_ID, 1000 + 120_001)).toBe(false);
    noteQuoteAvailability(FB_ID, false, 3000);
    expect(isQuoteUnavailable(FB_ID, 3000)).toBe(false);
  });
});

// ---------------------------------------------------------------- linking

describe("one id everywhere", () => {
  it("catalog, position, activity and create links resolve to the same route", () => {
    const href = marketHref(FB_ID);
    expect(href).toBe(`/markets/${FB_ID}`);
    const pos = parsePositions(FX.positions);
    const tape = parseTradesDetailed(FX.tape).trades;
    const ledger = parseAccountTrades(FX.ledger).items;
    const catalogRow = parseMarket(FX.market)!;
    for (const id of [catalogRow.marketId, pos[0].marketId, tape[0].marketId!, ledger[0].marketId!]) {
      expect(marketHref(id)).toBe(href);
    }
    // The detail route's resolver (segments joined, decoded) gets the same id back.
    expect(decodeURIComponent(href.split("/markets/")[1])).toBe(FB_ID);
  });
  it("a position whose market metadata can't be fetched keeps its row and id", () => {
    const [p] = parsePositions({ wallet: WALLET, positions: [{ marketId: OTHER_MARKET, side: "yes", shares: "1.5" }] });
    const row = enrichPosition(p, null, null, NOW * 1000);
    expect(row.marketId).toBe(OTHER_MARKET);
    expect(row.title).toBe(OTHER_MARKET); // → "Metadata unavailable" in the Book
    expect(row.shares).toBe("1.5");
  });
  it("selectMergedMarket keeps the catalog row id and the detail id identical", () => {
    const m = selectMergedMarket([market({ sources: { list: true, chain: true, detail: false } })], FB_ID, parseMarket(FX.market));
    expect(m?.marketId).toBe(FB_ID);
  });
});

// ---------------------------------------------------------------- reconciliation

const sessionTrade = (over: Partial<SessionTrade> = {}): SessionTrade => ({
  signature: SIG("A"),
  marketId: FB_ID,
  wallet: WALLET,
  side: "yes",
  amountBase: "500000",
  orderId: "ord_1",
  quotedShares: "0.99",
  confirmedAt: 1,
  verify: "idle",
  verifyStatus: null,
  baselineShares: 2.99,
  baselineKnown: true,
  reconcile: "pending",
  attempts: 0,
  tapeIndexed: false,
  ...over,
});

const pos = (shares: string, side: "yes" | "no" = "yes", marketId = FB_ID): Position =>
  parsePositions({ wallet: WALLET, positions: [{ marketId, side, shares }] })[0];
const tapeRow = (sig: string, over: Partial<Trade> = {}): Trade => ({
  id: null, marketId: FB_ID, wallet: WALLET, signature: sig, blockTime: 1_791_154_469, isPrimary: true, kind: "buy", side: "yes", shares: 0.988152, amountUsdc: 0.5, ...over,
});

describe("trade → position reconciliation", () => {
  it("invalidation plan covers market, tape, positions, balance, activity; catalog stale-only", () => {
    const plan = tradeInvalidationPlan(FB_ID, WALLET);
    expect(plan).toEqual([
      { queryKey: qk.market(FB_ID), refetch: true },
      { queryKey: qk.trades(FB_ID), refetch: true },
      { queryKey: qk.positions(WALLET), refetch: true },
      { queryKey: qk.usdc(WALLET), refetch: true },
      { queryKey: ["accountTrades"], refetch: true },
      { queryKey: qk.catalog(), refetch: false },
    ]);
  });
  it("baseline: unknown when positions weren't loaded; null shares when no row", () => {
    expect(positionBaseline(undefined, FB_ID, "yes")).toEqual({ known: false, shares: null });
    expect(positionBaseline([], FB_ID, "yes")).toEqual({ known: true, shares: null });
    expect(positionBaseline([pos("2.99")], FB_ID, "yes")).toEqual({ known: true, shares: 2.99 });
  });
  it("delayed position indexing: unchanged shares are not reflected (no fake shares)", () => {
    const t = sessionTrade();
    expect(evaluateReconcile(t, [pos("2.99")], [])).toEqual({ tapeIndexed: false, positionReflected: false });
    expect(evaluateReconcile(t, undefined, undefined)).toEqual({ tapeIndexed: false, positionReflected: false });
    expect(evaluateReconcile(t, [pos("3.978751")], [tapeRow(t.signature)])).toEqual({ tapeIndexed: true, positionReflected: true });
  });
  it("unknown baseline needs Panta's tape to list the signature", () => {
    const t = sessionTrade({ baselineKnown: false, baselineShares: null });
    expect(evaluateReconcile(t, [pos("3.97")], []).positionReflected).toBe(false);
    expect(evaluateReconcile(t, [pos("3.97")], [tapeRow(t.signature)]).positionReflected).toBe(true);
  });
  it("other side / other market rows never count", () => {
    const t = sessionTrade({ baselineShares: null });
    expect(evaluateReconcile(t, [pos("5", "no"), pos("5", "yes", OTHER_MARKET)], []).positionReflected).toBe(false);
  });

  const deps = (positions: Position[][], tapes: Trade[][]) => {
    let pi = 0;
    let ti = 0;
    const calls = { positions: 0, tape: 0, sleeps: [] as number[] };
    return {
      calls,
      deps: {
        fetchPositions: async () => {
          calls.positions++;
          return positions[Math.min(pi++, positions.length - 1)];
        },
        fetchTrades: async (): Promise<TapePage> => {
          calls.tape++;
          const trades = tapes[Math.min(ti++, tapes.length - 1)];
          return { trades, completeness: { returned: trades.length, parsed: trades.length, dropped: 0, complete: true } };
        },
        sleep: async (ms: number) => {
          calls.sleeps.push(ms);
        },
        now: () => 1000,
      },
    };
  };

  it("confirmed trade → records once, invalidates, and refetches until Panta reflects it", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.positions(WALLET), [pos("2.99")]);
    const sig = SIG("B");
    const d = deps([[pos("2.99")], [pos("3.978751")]], [[], [tapeRow(sig)]]);
    const input = { signature: sig, marketId: FB_ID, wallet: WALLET, side: "yes" as const, amountBase: "500000" };
    // Background follow-up parked (its sleep never resolves); driven explicitly below.
    const parked = { ...d.deps, sleep: () => new Promise<void>(() => {}) };
    expect(onTradeConfirmed(qc, input, parked)).toBe(true);
    expect(onTradeConfirmed(qc, input, parked)).toBe(false); // no duplicate loop
    // Never writes a position from the quote: cache still holds Panta's last value.
    expect(qc.getQueryData<Position[]>(qk.positions(WALLET))?.[0].shares).toBe("2.99");
    expect(tradeSession.get(sig)).toMatchObject({ reconcile: "pending", baselineShares: 2.99, baselineKnown: true });
    await runTradeReconcile(qc, sig, d.deps);
    expect(d.calls.positions).toBe(2); // stopped as soon as Panta reflected the trade
    expect(tradeSession.get(sig)?.reconcile).toBe("reflected");
    expect(qc.getQueryData<Position[]>(qk.positions(WALLET))?.[0].shares).toBe("3.978751");
  });
  it("Panta never catches up → bounded attempts, then stale (no infinite loop)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sig = SIG("C");
    tradeSession.record(sessionTrade({ signature: sig }));
    const d = deps([[pos("2.99")]], [[]]);
    await runTradeReconcile(qc, sig, d.deps);
    expect(d.calls.sleeps).toEqual([...RECONCILE_DELAYS_MS]);
    expect(d.calls.positions).toBe(RECONCILE_DELAYS_MS.length);
    expect(tradeSession.get(sig)).toMatchObject({ reconcile: "stale", attempts: RECONCILE_DELAYS_MS.length });
    // Position stays Panta's value; nothing fabricated from the quote.
    expect(qc.getQueryData<Position[]>(qk.positions(WALLET))?.[0].shares).toBe("2.99");
  });
  it("delayed market refresh / API failures during follow-up give no fake values", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sig = SIG("D");
    tradeSession.record(sessionTrade({ signature: sig }));
    const failing = {
      fetchPositions: async () => {
        throw new Error("502");
      },
      fetchTrades: async (): Promise<TapePage> => {
        throw new Error("502");
      },
      sleep: async () => {},
      now: () => 1,
    };
    await runTradeReconcile(qc, sig, failing);
    expect(tradeSession.get(sig)?.reconcile).toBe("stale");
    expect(qc.getQueryData(qk.positions(WALLET))).toBeUndefined();
  });
  it("malformed confirmations are ignored (no record, no invalidation)", () => {
    const qc = new QueryClient();
    expect(onTradeConfirmed(qc, { signature: "short", marketId: FB_ID, wallet: WALLET, side: "yes", amountBase: "1" })).toBe(false);
    expect(onTradeConfirmed(qc, { signature: SIG("E"), marketId: "bad id", wallet: WALLET, side: "yes", amountBase: "1" })).toBe(false);
    expect(tradeSession.list()).toHaveLength(0);
  });
  it("failed / uncertain / rejected trades never reach the reconciler (ticket state stays unverified)", () => {
    const base: TradeSnapshot = {
      connected: true, closed: null, running: null, failure: null, hasQuote: true, quoteStale: false, quoteExpired: false,
      hasBuild: true, presignOk: true, hasSignature: true, txPhase: "pending", verifyPhase: "idle", attrPhase: "idle",
    } as TradeSnapshot;
    expect(deriveTradeState(base)).toBe("confirm_timeout"); // uncertain ≠ failed ≠ confirmed
    expect(deriveTradeState({ ...base, txPhase: "failed" })).toBe("tx_failed");
    expect(tradeSession.list()).toHaveLength(0); // only onConfirmed records, and only the ticket calls it after confirmation
  });
});

// ---------------------------------------------------------------- activity + verification

describe("activity + verification", () => {
  const tape = parseTradesDetailed(FX.tape).trades;
  const ledger = parseAccountTrades(FX.ledger).items;

  it("historic France–Belgium buys: indexed + attributed, never 'verified' without Panta order verification", () => {
    const items = buildMarketActivity({ marketId: FB_ID, wallet: WALLET, tape, ledger, session: [] });
    expect(items).toHaveLength(4);
    for (const it of items) {
      expect(it.tx).toBe("indexed");
      expect(it.attribution).toBe("attributed");
      expect(it.verification).toBe("not_checked");
      expect(it.shares).not.toBeNull();
      expect(it.side).toBe("yes");
      expect(it.amountUsdc).toBe(0.5);
    }
    // Other wallets' rows never show as "yours".
    expect(buildMarketActivity({ marketId: FB_ID, wallet: OTHER_WALLET, tape, ledger, session: [] })).toHaveLength(0);
    expect(buildMarketActivity({ marketId: FB_ID, wallet: null, tape, ledger, session: [] })).toHaveLength(0);
  });
  it("confirmed vs verified: verified only after Panta's order verify returned confirmed", () => {
    const sig = SIG("F");
    const s = sessionTrade({ signature: sig });
    let [it] = buildMarketActivity({ marketId: FB_ID, wallet: WALLET, tape: [], ledger: [], session: [s] });
    expect(it.tx).toBe("confirmed");
    expect(it.shares).toBeNull(); // no Panta index yet → no shares (quote never used)
    expect(it.verification).toBe("not_checked");
    [it] = buildMarketActivity({ marketId: FB_ID, wallet: WALLET, tape: [], ledger: [], session: [{ ...s, verify: "timeout", verifyStatus: "submitted" }] });
    expect(it.verification).toBe("verify_slow");
    [it] = buildMarketActivity({ marketId: FB_ID, wallet: WALLET, tape: [tapeRow(sig)], ledger: [], session: [{ ...s, verify: "confirmed", verifyStatus: "confirmed" }] });
    expect(it.verification).toBe("verified");
    expect(it.shares).toBe(0.988152);
    expect(it.tx).toBe("indexed");
  });
  it("wrong market / side / wallet for the signature can't show verified", () => {
    const sig = SIG("G");
    const s = sessionTrade({ signature: sig, verify: "confirmed", verifyStatus: "confirmed" });
    for (const bad of [{ marketId: OTHER_MARKET }, { side: "no" as const }, { wallet: OTHER_WALLET }]) {
      const [it] = buildMarketActivity({ marketId: FB_ID, wallet: WALLET, tape: [tapeRow(sig, bad)], ledger: [], session: [s] });
      expect(it.verification).toBe("mismatch");
      expect(it.mismatchReason).toBeTruthy();
    }
    const [led] = buildMarketActivity({
      marketId: FB_ID, wallet: WALLET, tape: [],
      ledger: [{ signature: sig, wallet: WALLET, marketId: OTHER_MARKET, side: "yes", kind: "buy", amountUsdc: 0.5, status: "processed", createdAt: null }],
      session: [s],
    });
    expect(led.verification).toBe("mismatch");
  });
  it("a non-success verify status is never verified", () => {
    const sig = SIG("H");
    const [it] = buildMarketActivity({ marketId: FB_ID, wallet: WALLET, tape: [], ledger: [], session: [sessionTrade({ signature: sig, verify: "confirmed", verifyStatus: "submitted" })] });
    expect(it.verification).toBe("not_checked");
    onTradeVerify(null, "confirmed", "confirmed"); // no signature → no-op
    expect(tradeSession.list()).toHaveLength(0);
  });
  it("ledger unavailable vs not listed are distinct", () => {
    const s = sessionTrade({ signature: SIG("J") });
    expect(buildMarketActivity({ marketId: FB_ID, wallet: WALLET, tape: [], ledger: null, session: [s] })[0].attribution).toBe("unknown");
    expect(buildMarketActivity({ marketId: FB_ID, wallet: WALLET, tape: [], ledger: [], session: [s] })[0].attribution).toBe("not_listed");
  });
  it("session records are scoped to market + wallet", () => {
    tradeSession.record(sessionTrade({ signature: SIG("K") }));
    tradeSession.record(sessionTrade({ signature: SIG("L"), marketId: OTHER_MARKET }));
    expect(sessionTradesFor(FB_ID, WALLET).map((t) => t.signature)).toEqual([SIG("K")]);
    expect(sessionTradesFor(FB_ID, OTHER_WALLET)).toEqual([]);
    expect(sessionTradesFor(FB_ID, null)).toEqual([]);
  });
  it("ticket: attribution without Panta verification is not 'Verified'", () => {
    const base = { connected: true, closed: null, running: null, failure: null, hasQuote: true, quoteStale: false, quoteExpired: false, hasBuild: true, presignOk: true, hasSignature: true, txPhase: "confirmed", attrPhase: "attributed" } as unknown as TradeSnapshot;
    expect(deriveTradeState({ ...base, verifyPhase: "timeout" })).toBe("attributed_unverified");
    expect(deriveTradeState({ ...base, verifyPhase: "idle" })).toBe("attributed_unverified");
    expect(deriveTradeState({ ...base, verifyPhase: "failed" })).toBe("verify_failed");
    expect(deriveTradeState({ ...base, verifyPhase: "confirmed" })).toBe("attributed");
  });
});

// ---------------------------------------------------------------- created markets

const memKV = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
};
const recovery = (stage: CreateRecoveryRecord["stage"]): CreateRecoveryRecord => ({
  v: 1, wallet: WALLET, createId: "cr_0123456789abcdef", signature: SIG("M"), expectedEventPda: OTHER_MARKET, marketType: "standard",
  paymentBase: "20000000", question: "Q?", title: null, recentBlockhash: FB_ID, lastValidBlockHeight: 1, stage, lastError: null, savedAt: 1,
});

describe("created-market lifecycle", () => {
  it("case 1: indexed immediately → normal lifecycle (evidence ignored, pruned)", () => {
    const kv = memKV();
    const store = createdMarketsStore(() => kv, () => 1_000_000);
    expect(store.remember({ marketId: FB_ID, signature: SIG("N"), question: "Q" })).toBe(true);
    const indexed = market({ sources: { list: true, chain: true, detail: true } });
    const s = marketState({ marketId: FB_ID, market: indexed, createdEvidence: store.get(FB_ID), now: NOW });
    expect(s.kind).toBe("active");
    store.prune([FB_ID]);
    expect(store.list()).toEqual([]);
  });
  it("case 2: registered but not indexed → awaiting indexing, no fabricated market; later appears", () => {
    const kv = memKV();
    const store = createdMarketsStore(() => kv, () => 1_000_000);
    store.remember({ marketId: OTHER_MARKET, signature: SIG("P"), question: "Will it?" });
    const ev = store.get(OTHER_MARKET);
    // No Panta record at all.
    const s1 = marketState({ marketId: OTHER_MARKET, market: null, error: new Error("MARKET_NOT_FOUND"), notFound: true, createdEvidence: ev });
    expect(s1).toMatchObject({ kind: "awaiting_indexing", tradableHere: false });
    // Only an on-chain catalog row (Panta can't quote it yet): still awaiting, not tradable.
    const chainOnly = market({ marketId: OTHER_MARKET, sources: { list: false, chain: true, detail: false } });
    expect(isPantaIndexed(chainOnly)).toBe(false);
    expect(marketState({ marketId: OTHER_MARKET, market: chainOnly, createdEvidence: ev, now: NOW })).toMatchObject({ kind: "awaiting_indexing", tradableHere: false });
    expect(awaitingIndexing(store.list(), new Set())).toHaveLength(1);
    // Panta indexes it → normal lifecycle; catalog notice drops it.
    const indexed = market({ marketId: OTHER_MARKET, sources: { list: true, chain: true, detail: true } });
    expect(marketState({ marketId: OTHER_MARKET, market: indexed, createdEvidence: ev, now: NOW }).kind).toBe("active");
    expect(awaitingIndexing(store.list(), new Set([OTHER_MARKET]))).toHaveLength(0);
  });
  it("evidence for another id never applies; loading never shows awaiting", () => {
    const ev = { marketId: OTHER_MARKET, signature: SIG("Q"), question: null, registeredAt: 1 };
    expect(marketState({ marketId: FB_ID, market: null, notFound: true, createdEvidence: ev }).kind).toBe("unavailable");
    expect(marketState({ marketId: OTHER_MARKET, market: null, loading: true, createdEvidence: ev }).kind).toBe("loading");
  });
  it("case 3: needs-attention never becomes a normal tradable market until Panta has a record", () => {
    expect(needsRegistration(recovery("registration_needs_attention"))).toBe(true);
    expect(needsRegistration(recovery("confirmed"))).toBe(true);
    expect(needsRegistration(recovery("broadcast"))).toBe(false);
    expect(needsRegistration(null)).toBe(false);
    const chainOnlyOpen = market({ marketId: OTHER_MARKET, sources: { list: false, chain: true, detail: false } });
    const s = marketState({ marketId: OTHER_MARKET, market: chainOnlyOpen, registrationNeedsAttention: true, now: NOW });
    expect(s).toMatchObject({ kind: "registration_needs_attention", tradableHere: false });
    expect(marketState({ marketId: OTHER_MARKET, market: null, registrationNeedsAttention: true }).kind).toBe("registration_needs_attention");
    // Once Panta registers + indexes it, Panta's record wins.
    const indexed = market({ marketId: OTHER_MARKET, sources: { list: true, chain: true, detail: true } });
    expect(marketState({ marketId: OTHER_MARKET, market: indexed, registrationNeedsAttention: true, now: NOW }).kind).toBe("active");
  });
  it("evidence store rejects malformed receipts and expires old ones", () => {
    const kv = memKV();
    let now = 1_000_000;
    const store = createdMarketsStore(() => kv, () => now);
    expect(store.remember({ marketId: "bad", signature: SIG("R") })).toBe(false);
    expect(store.remember({ marketId: FB_ID, signature: "short" })).toBe(false);
    expect(store.remember({ marketId: FB_ID, signature: SIG("R") })).toBe(true);
    expect(store.remember({ marketId: FB_ID, signature: SIG("R") })).toBe(true);
    expect(store.list()).toHaveLength(1); // deduped
    now += 15 * 24 * 3600_000;
    expect(store.list()).toHaveLength(0);
    expect(parseCreatedMarkets("{not json", 1)).toEqual([]);
    expect(parseCreatedMarkets(JSON.stringify([{ marketId: FB_ID, signature: SIG("S"), question: null, registeredAt: 1, extra: 1 }]), 2)).toEqual([]);
    expect(kv.raw.has(CREATED_MARKETS_KEY)).toBe(true);
  });
});

// ---------------------------------------------------------------- error semantics

describe("error semantics", () => {
  it("missing price ≠ 0; missing position ≠ zero position", () => {
    const priceless = market({ yesPrice: null, noPrice: null });
    const px = marketProbability(priceless);
    expect(px.yes).toBeNull();
    expect(px.no).toBeNull();
    expect(px.reason).not.toBeNull();
    expect(marketState({ marketId: FB_ID, market: priceless, now: NOW }).kind).toBe("active");
    // Positions not loaded → baseline unknown (not "0 shares").
    expect(positionBaseline(undefined, FB_ID, "yes").known).toBe(false);
  });
  it("labels are distinct per state", () => {
    const labels = new Set([
      marketState({ marketId: FB_ID, market: null, error: new Error("x") }).label,
      marketState({ marketId: FB_ID, market: null, notFound: true }).label,
      marketState({ marketId: FB_ID, market: market(), quoteUnavailable: true, now: NOW }).label,
      marketState({ marketId: FB_ID, market: market({ endTime: NOW - 1 }), now: NOW }).label,
      marketState({ marketId: FB_ID, market: market({ resolved: true }), now: NOW }).label,
      marketState({ marketId: FB_ID, market: null, createdEvidence: { marketId: FB_ID } }).label,
      marketState({ marketId: FB_ID, market: null, registrationNeedsAttention: true }).label,
    ]);
    expect(labels.size).toBe(7);
    for (const l of labels) expect(l).not.toMatch(/something went wrong/i);
  });
});
