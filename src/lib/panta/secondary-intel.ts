/**
 * Secondary Market Intelligence (Phase 2) — read-only, deterministic.
 *
 * Consumes authoritative market fields + tape. Never builds/signs secondary
 * orders, never calls undocumented price endpoints, never treats independent
 * YES/NO secondary prices as complementary probabilities.
 *
 * Secondary activity / radar score (deterministic; NOT expected return, edge,
 * probability, profit, or buy/sell score):
 *
 *   score =
 *     40 * clamp(secondaryPrintCount / 20, 0, 1)
 *   + 30 * clamp(tradedShares / 200, 0, 1)          // 0 when share sizes incomplete
 *   + 15 * recencyBoost(latestPrintAgeMinutes)     // 1 <1h · 0.5 <24h · 0.2 <72h · else 0
 *   + 10 * clamp(uniqueReadableWallets / 10, 0, 1)
 *   +  5 * resolutionProximity(minutesToResolution)// 1 <24h · 0.5 <7d · 0.2 known future · else 0
 *
 * Radar sort: score desc → secondaryPrintCount desc → tradedShares desc → marketId asc.
 */

import { marketLifecycle } from "./catalog";
import type { Market, TapeCompleteness, Trade } from "./domain";
import {
  decodeSecondaryPriceField,
  secondaryLastObservedPrices,
  type SecondaryLastObserved,
} from "./prices";
import { formatResolutionCountdown } from "@/lib/format";
import { SIGNAL_THRESHOLDS } from "./signals";

export type SecondaryObservedPrice = SecondaryLastObserved;
export const decodeSecondaryPrice = decodeSecondaryPriceField;
export const secondaryObservedPrices = secondaryLastObservedPrices;

/** Public Panta market page (proven: GET https://panta.market/market/{id} returns the market). */
export function pantaMarketUrl(marketId: string): string {
  return `https://panta.market/market/${encodeURIComponent(marketId)}`;
}

export const ORDER_BOOK_DEPTH_UNAVAILABLE =
  "Order-book depth unavailable through the current partner data surface.";

export const SECONDARY_PHASE_LINE = "Secondary phase · primary buys closed";
export const SECONDARY_EXEC_LINE =
  "Brief Command provides secondary-market intelligence here; secondary CLOB execution is not currently routed through this desk.";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function isSecondaryMarket(
  m: Pick<Market, "phase" | "status" | "resolved" | "endTime" | "primaryPhaseEndTime">,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (m.resolved) return false;
  const lc = marketLifecycle(m, nowSec);
  if (lc === "trading") return true;
  const phase = (m.phase || "").toLowerCase();
  return phase === "secondary";
}

/** Show the primary Buy ticket only for primary-open markets. */
export function showsPrimaryBuyTicket(
  m: Pick<Market, "phase" | "status" | "resolved" | "endTime" | "primaryPhaseEndTime">,
  nowSec?: number,
): boolean {
  if (m.resolved) return false;
  const lc = marketLifecycle(m, nowSec ?? Math.floor(Date.now() / 1000));
  return lc === "open";
}

export function showsSecondaryIntelligence(
  m: Pick<Market, "phase" | "status" | "resolved" | "endTime" | "primaryPhaseEndTime">,
  nowSec?: number,
): boolean {
  return isSecondaryMarket(m, nowSec);
}

/** Secondary prints only (`isPrimary === false`). Unknown primary flag is excluded. */
export function filterSecondaryPrints(tape: Trade[]): Trade[] {
  return tape.filter((t) => t.isPrimary === false);
}

export type SecondaryFlow = {
  yesShares: number | null;
  noShares: number | null;
  yesShare: number | null;
  noShare: number | null;
  imbalance: number | null;
  basis: "shares" | "prints" | null;
  oneSided: boolean;
  balanced: boolean;
  yesPrints: number;
  noPrints: number;
  printCount: number;
  tradedShares: number | null;
  uniqueWallets: number;
  latestPrintTime: number | null;
  latestPrintAgeMinutes: number | null;
};

/**
 * Deterministic secondary flow from secondary prints only.
 * No prices from tape; never infer trade price from shares/USDC.
 */
export function secondaryFlow(prints: Trade[], nowMs: number = Date.now()): SecondaryFlow {
  const T = SIGNAL_THRESHOLDS;
  let yesPrints = 0;
  let noPrints = 0;
  let yesShares = 0;
  let noShares = 0;
  let sidedWithShares = 0;
  let sharesSum = 0;
  let sharesRows = 0;
  const wallets = new Set<string>();
  const times: number[] = [];

  for (const t of prints) {
    if (t.side === "yes") yesPrints += 1;
    else if (t.side === "no") noPrints += 1;
    if (t.side && t.shares != null && Number.isFinite(t.shares)) {
      sidedWithShares += 1;
      if (t.side === "yes") yesShares += t.shares;
      else noShares += t.shares;
    }
    if (t.shares != null && Number.isFinite(t.shares)) {
      sharesSum += t.shares;
      sharesRows += 1;
    }
    if (t.wallet) wallets.add(t.wallet);
    if (t.blockTime != null) times.push(t.blockTime);
  }

  const printCount = prints.length;
  const sided = yesPrints + noPrints;
  const completeShares = printCount > 0 && sharesRows === printCount;
  const tradedShares = completeShares ? sharesSum : null;

  let basis: "shares" | "prints" | null = null;
  let yesShare: number | null = null;
  let noShare: number | null = null;
  let imbalance: number | null = null;
  let yesSharesOut: number | null = null;
  let noSharesOut: number | null = null;

  if (sidedWithShares > 0 && sidedWithShares === sided && sided > 0) {
    const total = yesShares + noShares;
    if (total > 0) {
      basis = "shares";
      yesShare = yesShares / total;
      noShare = noShares / total;
      imbalance = (yesShares - noShares) / total;
      yesSharesOut = yesShares;
      noSharesOut = noShares;
    }
  } else if (sided > 0) {
    basis = "prints";
    yesShare = yesPrints / sided;
    noShare = noPrints / sided;
    imbalance = (yesPrints - noPrints) / sided;
  }

  const latestPrintTime = times.length ? Math.max(...times) : null;
  const latestPrintAgeMinutes =
    latestPrintTime != null ? Math.max(0, (nowMs / 1000 - latestPrintTime) / 60) : null;

  const oneSided = imbalance != null && Math.abs(imbalance) >= T.oneSidedImbalance;
  const balanced = imbalance != null && Math.abs(imbalance) < T.balancedImbalance;

  return {
    yesShares: yesSharesOut,
    noShares: noSharesOut,
    yesShare,
    noShare,
    imbalance,
    basis,
    oneSided,
    balanced,
    yesPrints,
    noPrints,
    printCount,
    tradedShares,
    uniqueWallets: wallets.size,
    latestPrintTime,
    latestPrintAgeMinutes,
  };
}

export type TapeQuality =
  | { kind: "ok" }
  | { kind: "partial"; returned: number; parsed: number; dropped: number; label: "Partial sample" }
  | { kind: "failed"; label: string }
  | { kind: "loading" }
  | { kind: "empty" };

export function secondaryTapeQuality(opts: {
  isError: boolean;
  isPending: boolean;
  hasData: boolean;
  completeness: TapeCompleteness | null | undefined;
  secondaryPrintCount: number;
}): TapeQuality {
  if (opts.isError && !opts.hasData) return { kind: "failed", label: "Secondary tape request failed" };
  if (opts.isPending && !opts.hasData) return { kind: "loading" };
  if (opts.isError && opts.hasData) return { kind: "failed", label: "Secondary tape refresh failed" };
  const c = opts.completeness;
  if (c && !c.complete && c.dropped > 0) {
    return {
      kind: "partial",
      returned: c.returned,
      parsed: c.parsed,
      dropped: c.dropped,
      label: "Partial sample",
    };
  }
  if (opts.hasData && opts.secondaryPrintCount === 0) return { kind: "empty" };
  return { kind: "ok" };
}

function recencyBoost(ageMin: number | null): number {
  if (ageMin == null) return 0;
  if (ageMin < 60) return 1;
  if (ageMin < 24 * 60) return 0.5;
  if (ageMin < 72 * 60) return 0.2;
  return 0;
}

function resolutionProximity(minutesToResolution: number | null): number {
  if (minutesToResolution == null) return 0;
  if (minutesToResolution < 0) return 0;
  if (minutesToResolution < 24 * 60) return 1;
  if (minutesToResolution < 7 * 24 * 60) return 0.5;
  return 0.2;
}

export type SecondaryActivityInputs = {
  secondaryPrintCount: number;
  tradedShares: number | null;
  latestPrintAgeMinutes: number | null;
  uniqueWallets: number;
  minutesToResolution: number | null;
};

/** See file header for the exact formula. */
export function secondaryActivityScore(input: SecondaryActivityInputs): number {
  const prints = 40 * clamp01(input.secondaryPrintCount / 20);
  const shares = 30 * clamp01((input.tradedShares ?? 0) / 200);
  const recency = 15 * recencyBoost(input.latestPrintAgeMinutes);
  const wallets = 10 * clamp01(input.uniqueWallets / 10);
  const reso = 5 * resolutionProximity(input.minutesToResolution);
  return Math.round((prints + shares + recency + wallets + reso) * 1000) / 1000;
}

export type SecondaryIntelSnapshot = {
  marketId: string;
  title: string;
  secondary: true;
  prices: SecondaryObservedPrice;
  flow: SecondaryFlow;
  activityScore: number;
  minutesToResolution: number | null;
  resolutionLabel: string;
  tapeQuality: TapeQuality;
};

export function resolutionCountdownLabel(
  market: Pick<Market, "resolutionTime" | "endTime" | "resolved" | "phase">,
  nowMs: number,
): { minutes: number | null; label: string } {
  const nowSec = Math.floor(nowMs / 1000);
  if (market.resolved || (market.phase || "").toLowerCase() === "resolved") {
    return { minutes: null, label: "Resolved" };
  }
  const ts = market.resolutionTime ?? market.endTime ?? null;
  if (ts == null || !(ts > 0)) return { minutes: null, label: "Unknown" };
  const mins = (ts - nowSec) / 60;
  if (mins <= 0) {
    const ended = market.endTime != null && market.endTime <= nowSec;
    return { minutes: mins, label: ended ? "Event ended · awaiting resolution" : "Resolved" };
  }
  return { minutes: mins, label: formatResolutionCountdown(mins * 60) };
}

export function buildSecondarySnapshot(
  market: Market,
  tape: Trade[],
  nowMs: number,
  tapeQuality: TapeQuality,
): SecondaryIntelSnapshot {
  const prints = filterSecondaryPrints(tape);
  const flow = secondaryFlow(prints, nowMs);
  const reso = resolutionCountdownLabel(market, nowMs);
  const activityScore = secondaryActivityScore({
    secondaryPrintCount: flow.printCount,
    tradedShares: flow.tradedShares,
    latestPrintAgeMinutes: flow.latestPrintAgeMinutes,
    uniqueWallets: flow.uniqueWallets,
    minutesToResolution: reso.minutes != null && reso.minutes > 0 ? reso.minutes : null,
  });
  return {
    marketId: market.marketId,
    title: (market.title || "").trim() || market.marketId,
    secondary: true,
    prices: secondaryObservedPrices(market),
    flow,
    activityScore,
    minutesToResolution: reso.minutes,
    resolutionLabel: reso.label,
    tapeQuality,
  };
}

export type RadarRow = SecondaryIntelSnapshot & { flowDirection: string };

export function flowDirectionLabel(flow: SecondaryFlow): string {
  if (flow.printCount === 0) return "No observed secondary prints — secondary flow unavailable";
  if (flow.imbalance == null) return "—";
  if (flow.balanced) return "Balanced";
  if (flow.oneSided) return flow.imbalance > 0 ? "YES one-sided" : "NO one-sided";
  return flow.imbalance > 0 ? "YES lean" : "NO lean";
}

/** Stable deterministic radar ordering. */
export function sortRadarRows(rows: RadarRow[]): RadarRow[] {
  return [...rows].sort((a, b) => {
    if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
    if (b.flow.printCount !== a.flow.printCount) return b.flow.printCount - a.flow.printCount;
    const as = a.flow.tradedShares ?? -1;
    const bs = b.flow.tradedShares ?? -1;
    if (bs !== as) return bs - as;
    return a.marketId.localeCompare(b.marketId);
  });
}

/**
 * Bound tape fetches: secondary/trading markets ranked by catalog volume then
 * recency (endTime ascending = sooner first), capped at `max`.
 */
export function pickSecondaryRadarCandidates(markets: Market[], max = 6, nowSec = Math.floor(Date.now() / 1000)): Market[] {
  const vol = (m: Market) => {
    const v = Number(m.volumeUsdc ?? m.totalVolumeUsdc ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  return markets
    .filter((m) => isSecondaryMarket(m, nowSec))
    .sort((a, b) => {
      const dv = vol(b) - vol(a);
      if (dv !== 0) return dv;
      const ae = a.endTime ?? Number.POSITIVE_INFINITY;
      const be = b.endTime ?? Number.POSITIVE_INFINITY;
      if (ae !== be) return ae - be;
      return a.marketId.localeCompare(b.marketId);
    })
    .slice(0, max);
}

export function formatSecondaryPrice(v: number | null): string {
  if (v == null) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 2 })} USDC`;
}

export function formatAgeMinutes(mins: number | null): string {
  if (mins == null) return "—";
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
