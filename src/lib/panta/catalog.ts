/**
 * Full market catalog: shapes and pure logic shared by the server route
 * (/api/catalog) and the browser. No I/O here.
 *
 * Sources, merged per marketId:
 *  - Panta REST list rows (GET /markets/ for every status × category filter;
 *    the list caps at 50 and its cursor repeats page 1, so this is a union);
 *  - on-chain `Event` accounts of the Panta program (complete enumeration,
 *    authoritative lifecycle, question text, end time, last price, volume);
 *  - Panta detail records (GET /markets/{id}/) for every live market.
 */

import { chainPhase, formatUsdcBase, type ChainEvent } from "./chain-events";
import type { Market } from "./domain";
import { mergeMarket } from "./markets";

/**
 * - open: primary phase, buy window still running (buyable in our ticket)
 * - trading: secondary phase, event not ended (trades on panta.market)
 * - ended: end time passed, no final result yet (awaiting resolution)
 * - resolved / cancelled: final
 * - unknown: no phase from any source and not ended
 */
export type Lifecycle = "open" | "trading" | "unknown" | "ended" | "resolved" | "cancelled";

export const LIFECYCLE_ORDER: readonly Lifecycle[] = ["open", "trading", "unknown", "ended", "resolved", "cancelled"];

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  open: "Primary · open",
  trading: "Secondary · live",
  unknown: "Phase unknown",
  ended: "Closed · awaiting result",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

type LifecycleInput = Pick<Market, "phase" | "status" | "resolved" | "endTime"> & {
  primaryPhaseEndTime?: number | null;
};

const nowSec = () => Math.floor(Date.now() / 1000);

export function marketLifecycle(m: LifecycleInput, now: number = nowSec()): Lifecycle {
  const phase = (m.phase || "").toLowerCase();
  const status = (m.status || "").toLowerCase();
  if (m.resolved || phase === "resolved" || status === "resolved") return "resolved";
  if (["cancelled", "canceled"].includes(phase) || ["cancelled", "canceled"].includes(status)) return "cancelled";
  const ended = typeof m.endTime === "number" && m.endTime > 0 && m.endTime <= now;
  if (ended) return "ended";
  if (phase === "primary" || (!phase && (status === "primary" || status === "open"))) {
    // Primary buys stop at primaryPhaseEndTime (before the event's endTime).
    const windowClosed =
      typeof m.primaryPhaseEndTime === "number" && m.primaryPhaseEndTime > 0 && m.primaryPhaseEndTime <= now;
    return windowClosed ? "ended" : "open";
  }
  if (phase === "secondary" || (!phase && (status === "secondary" || status === "secondary_active"))) return "trading";
  return "unknown";
}

export const lifecycleRank = (m: LifecycleInput, now?: number) => LIFECYCLE_ORDER.indexOf(marketLifecycle(m, now));

/** Open or trading: the markets a visitor can act on right now (here or on panta.market). */
export const isLiveMarket = (m: LifecycleInput, now?: number) => lifecycleRank(m, now) <= 1;

/** Primary buy window open: the only markets our execute ticket can buy. */
export const isBuyableMarket = (m: LifecycleInput, now?: number) => marketLifecycle(m, now) === "open";

export type CatalogCounts = Record<Lifecycle, number> & { total: number; live: number };

export function countLifecycles(items: LifecycleInput[], now: number = nowSec()): CatalogCounts {
  const c: CatalogCounts = { total: items.length, live: 0, open: 0, trading: 0, unknown: 0, ended: 0, resolved: 0, cancelled: 0 };
  for (const m of items) c[marketLifecycle(m, now)] += 1;
  c.live = c.open + c.trading;
  return c;
}

export type CatalogSources = {
  /** Unique markets returned by the Panta REST list (union of all filters). */
  listUnique: number;
  /** REST list requests made (each capped at 50 rows; the cursor repeats page 1). */
  listRequests: number;
  /** Event accounts found on-chain; null when chain discovery was unavailable. */
  chainAccounts: number | null;
  /** On-chain markets that no REST list query returned. */
  chainOnly: number;
  /** REST list rows with no Event account on mainnet; hidden when chain discovery succeeded. */
  listOnly: number;
  /** Live markets refreshed from the Panta detail endpoint. */
  detailHydrated: number;
  chainError?: string;
  listError?: string;
};

export type CatalogPayload = {
  items: Market[];
  counts: CatalogCounts;
  sources: CatalogSources;
  generatedAt: string;
};

/** Overlay an on-chain Event onto a (possibly missing) REST list row. */
export function applyChainEvent(row: Market | undefined, ev: ChainEvent): Market {
  const phase = chainPhase(ev);
  const base: Market = row ?? { marketId: ev.marketId, title: "", category: "", phase: "" };
  // lastYesPrice is the bonding-curve price: live only while primary; after
  // graduation it is the frozen price at graduation (see prices.ts). It is
  // stored as primary* only, never as the YES/NO spot.
  const curveYes = phase === "primary" || phase === "secondary" ? ev.lastYesPrice : null;
  return {
    ...base,
    title: base.title || ev.question,
    resolutionRule: base.resolutionRule || ev.resolutionRule || undefined,
    oracle: base.oracle || ev.oracle || null,
    phase,
    status: phase,
    resolved: ev.isResolved,
    startTime: ev.startTime || base.startTime || null,
    endTime: ev.endTime || base.endTime || null,
    resolutionTime: ev.resolutionTime || base.resolutionTime || null,
    primaryPhaseEndTime: ev.primaryPhaseEndTime ?? base.primaryPhaseEndTime ?? null,
    volumeUsdcBase: ev.activeVolumeBase,
    volumeUsdc: formatUsdcBase(ev.activeVolumeBase),
    totalVolumeUsdcBase: ev.totalVolumeBase,
    totalVolumeUsdc: formatUsdcBase(ev.totalVolumeBase),
    // Same number the detail endpoint returns as primaryYesPrice (lastYesPrice / 1e9).
    primaryYesPrice: base.primaryYesPrice ?? curveYes,
    primaryNoPrice:
      base.primaryNoPrice ?? (curveYes != null ? String(Number((1 - Number(curveYes)).toFixed(9))) : null),
    sources: { list: Boolean(row), chain: true, detail: false },
  };
}

/** Union list rows (deduped, first row wins) with on-chain events. */
export function mergeCatalog(listRows: Market[], chain: ChainEvent[] | null): Market[] {
  const byId = new Map<string, Market>();
  for (const m of listRows) {
    if (!byId.has(m.marketId)) byId.set(m.marketId, { ...m, sources: { list: true, chain: false, detail: false } });
  }
  if (chain) {
    for (const ev of chain) byId.set(ev.marketId, applyChainEvent(byId.get(ev.marketId), ev));
  }
  return [...byId.values()];
}

/** Detail record over a catalog row (keeps the chain lifecycle; see mergeMarket). */
export function withDetail(row: Market, detail: Market | null | undefined): Market {
  if (!detail) return row;
  const merged = mergeMarket(row, detail);
  return { ...merged, sources: { list: row.sources?.list ?? false, chain: row.sources?.chain ?? false, detail: true } };
}

const vol = (m: Market) => {
  const n = Number(m.totalVolumeUsdc ?? m.volumeUsdc ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Live first (primary open, then secondary), then ended-awaiting-result, then
 * resolved (most recent end first), then cancelled. Within live groups: volume.
 */
export function sortCatalog(items: Market[], now: number = nowSec()): Market[] {
  return [...items].sort((a, b) => {
    const ra = lifecycleRank(a, now);
    const rb = lifecycleRank(b, now);
    if (ra !== rb) return ra - rb;
    if (ra <= 2) return vol(b) - vol(a) || (a.endTime ?? Infinity) - (b.endTime ?? Infinity);
    return (b.endTime ?? 0) - (a.endTime ?? 0);
  });
}

export type CatalogFilter = { category?: string; status?: string };

/** Client-side filter over the full catalog. `status` accepts a Lifecycle, "live", or a raw phase. */
export function filterCatalog(items: Market[], f: CatalogFilter, now: number = nowSec()): Market[] {
  const cat = (f.category || "").toLowerCase();
  const st = (f.status || "").toLowerCase();
  return items.filter((m) => {
    if (cat && (m.category || "").toLowerCase() !== cat) return false;
    if (!st) return true;
    const lc = marketLifecycle(m, now);
    if (st === "live") return lc === "open" || lc === "trading";
    if ((LIFECYCLE_ORDER as readonly string[]).includes(st)) return lc === st;
    return (m.phase || "").toLowerCase() === st;
  });
}

/**
 * Single-market merge used by the catalog detail overlay and by /api/brief.
 * When `row` carries on-chain lifecycle (or any catalog foundation), a partial
 * or stale detail never demotes its phase (see mergeMarket). Detail-only is
 * returned only when there is no catalog row at all.
 */
export function resolveAuthoritativeMarket(
  row: Market | null | undefined,
  detail: Market | null | undefined,
): Market | null {
  if (row) return withDetail(row, detail);
  return detail ?? null;
}
