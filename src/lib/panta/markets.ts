/**
 * Markets adapter: GET /markets/, /markets/{id}/, /markets/{id}/trades/,
 * /categories/ → Market / Trade domain objects.
 *
 * Every response is parsed with zod at this boundary. Optional fields that
 * arrive with the wrong type degrade to undefined; unknown fields pass
 * through (looseObject). Only a row without a marketId is dropped.
 */

import { z } from "@/lib/zod";
import type { Json } from "@/lib/types";
import {
  ApiError,
  devWarn,
  numish,
  optBool,
  optNum,
  optStr,
  pantaFetch,
  parseOrNull,
  toStrOrNull,
} from "./client";
import type { CatalogPayload } from "./catalog";
import type { Market, MarketPage, TapePage, Trade } from "./domain";
import { normalizePantaTrade, type RawTradeRow } from "./normalize";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const RawMarketSchema = z.looseObject({
  marketId: z.string().min(1),
  title: optStr,
  question: optStr,
  category: optStr,
  description: optStr,
  resolutionRule: optStr,
  images: z.array(z.string()).nullish().catch(undefined),
  phase: optStr,
  status: optStr,
  marketType: optStr,
  startTime: optNum,
  endTime: optNum,
  resolutionTime: optNum,
  region: optStr,
  resolved: optBool,
  volumeUsdc: numish,
  volumeUsdcBase: numish,
  totalVolumeUsdc: numish,
  totalVolumeUsdcBase: numish,
  campaignId: optStr,
  createdByPartner: optBool,
  yesPrice: numish,
  noPrice: numish,
  primaryYesPrice: numish,
  primaryNoPrice: numish,
  secondaryYesPrice: numish,
  secondaryNoPrice: numish,
  creationFee: numish,
  creatorAddress: optStr,
  oracle: optStr,
  primaryPhaseEndTime: optNum,
});
export type RawMarket = z.infer<typeof RawMarketSchema>;

const RawMarketListSchema = z.looseObject({
  items: z.array(z.unknown()).catch([]),
  nextCursor: z.string().nullish().catch(null),
});

export const RawTradeSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).nullish().catch(undefined),
  marketId: optStr,
  wallet: optStr,
  isPrimary: optBool,
  yesAmount: numish,
  noAmount: numish,
  feePaid: numish,
  blockTime: optNum,
  signature: optStr,
  kind: optStr,
  side: optStr,
  amountUsdc: numish,
  amountUsdcBase: numish,
  shares: numish,
  sharesBase: numish,
});

const RawTradesSchema = z.looseObject({
  marketId: optStr,
  items: z.array(z.unknown()).catch([]),
});

const CategoriesSchema = z.looseObject({
  categories: z.array(z.string()).catch([]),
});

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const clean = (v: string | null | undefined) => (v ?? "").trim();

export function toMarket(r: RawMarket): Market {
  const title = clean(r.title) || clean(r.question);
  const opt = (v: string | null | undefined) => (clean(v) ? clean(v) : undefined);
  return {
    marketId: r.marketId,
    title,
    category: clean(r.category),
    description: opt(r.description),
    resolutionRule: opt(r.resolutionRule),
    images: r.images?.length ? r.images : undefined,
    phase: clean(r.phase).toLowerCase(),
    status: opt(r.status)?.toLowerCase(),
    marketType: opt(r.marketType),
    startTime: r.startTime ?? null,
    endTime: r.endTime ?? null,
    resolutionTime: r.resolutionTime ?? null,
    region: opt(r.region),
    resolved: r.resolved ?? undefined,
    volumeUsdc: toStrOrNull(r.volumeUsdc) ?? undefined,
    volumeUsdcBase: r.volumeUsdcBase ?? undefined,
    totalVolumeUsdc: toStrOrNull(r.totalVolumeUsdc) ?? undefined,
    totalVolumeUsdcBase: r.totalVolumeUsdcBase ?? undefined,
    campaignId: r.campaignId ?? null,
    createdByPartner: r.createdByPartner ?? undefined,
    yesPrice: toStrOrNull(r.yesPrice),
    noPrice: toStrOrNull(r.noPrice),
    primaryYesPrice: toStrOrNull(r.primaryYesPrice),
    primaryNoPrice: toStrOrNull(r.primaryNoPrice),
    secondaryYesPrice: toStrOrNull(r.secondaryYesPrice),
    secondaryNoPrice: toStrOrNull(r.secondaryNoPrice),
    creationFee: r.creationFee ?? null,
    creatorAddress: r.creatorAddress ?? null,
    oracle: r.oracle ?? null,
    primaryPhaseEndTime: r.primaryPhaseEndTime && r.primaryPhaseEndTime > 0 ? r.primaryPhaseEndTime : null,
  };
}

/** Parse a detail/list row. null (+ dev warning) when it has no marketId. */
export function parseMarket(raw: unknown): Market | null {
  const r = parseOrNull(RawMarketSchema, raw, "market");
  return r ? toMarket(r) : null;
}

export function parseMarketPage(raw: unknown): MarketPage {
  const page = parseOrNull(RawMarketListSchema, raw, "markets list");
  if (!page) return { items: [], nextCursor: null };
  const items: Market[] = [];
  let dropped = 0;
  for (const row of page.items) {
    const m = parseMarket(row);
    if (m) items.push(m);
    else dropped += 1;
  }
  if (dropped) devWarn(`markets list: dropped ${dropped} row(s) without a marketId`);
  return { items, nextCursor: page.nextCursor ?? null };
}

/** A trades response that is not a readable tape page (never treated as "no prints"). */
export class TapeDataError extends Error {
  constructor() {
    super("Panta returned a trades response that could not be read");
    this.name = "TapeDataError";
  }
}

/**
 * How much of a tape page was usable. `dropped` rows were returned by Panta
 * but could not be read (not an object, a numeric field present but not a
 * number, or no signature/id/blockTime to place the print). They are left
 * out — never turned into zero-size prints — and the page is marked partial.
 */
export type { TapeCompleteness, TapePage } from "./domain";

const NUMERIC_TAPE_FIELDS = ["shares", "sharesBase", "amountUsdc", "amountUsdcBase", "yesAmount", "noAmount"] as const;

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/** null when the row is unreadable (dropped), else the normalized print. */
function parseTradeRow(row: unknown): Trade | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = RawTradeSchema.safeParse(row);
  if (!r.success) return null;
  const o = row as Record<string, unknown>;
  for (const k of NUMERIC_TAPE_FIELDS) {
    if (!present(o[k])) continue;
    const v = o[k];
    if (typeof v !== "number" && typeof v !== "string") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
  }
  if (present(o.blockTime) && (typeof o.blockTime !== "number" || !Number.isFinite(o.blockTime))) return null;
  if (!present(o.signature) && !present(o.id) && !present(o.blockTime)) return null;
  return normalizePantaTrade(r.data as RawTradeRow);
}

/** Lenient: unreadable page → empty, complete=false only if rows were dropped. */
export function parseTradesDetailed(raw: unknown): TapePage {
  const page = parseOrNull(RawTradesSchema, raw, "market trades");
  const rows = page?.items ?? [];
  const trades: Trade[] = [];
  for (const row of rows) {
    const t = parseTradeRow(row);
    if (t) trades.push(t);
  }
  const dropped = rows.length - trades.length;
  if (dropped) devWarn(`market trades: dropped ${dropped} of ${rows.length} unreadable row(s)`);
  return { trades, completeness: { returned: rows.length, parsed: trades.length, dropped, complete: dropped === 0 } };
}

/**
 * Strict: throws TapeDataError on a malformed page (or one where no row is
 * readable) instead of returning []. A page with some unreadable rows is
 * returned with completeness.complete = false.
 */
export function parseTradesStrict(raw: unknown): TapePage {
  const items = raw && typeof raw === "object" ? (raw as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) throw new TapeDataError();
  const out = parseTradesDetailed(raw);
  // Rows came back but none could be read: that is missing data, not zero prints.
  if (items.length > 0 && out.trades.length === 0) throw new TapeDataError();
  return out;
}

export function parseTrades(raw: unknown): Trade[] {
  return parseTradesDetailed(raw).trades;
}

export function parseCategories(raw: unknown): string[] {
  return parseOrNull(CategoriesSchema, raw, "categories")?.categories ?? [];
}

// ---------------------------------------------------------------------------
// Partial detail records
// ---------------------------------------------------------------------------

/**
 * The live detail endpoint intermittently returns a partial record (~41 of
 * ~89 fields): no title/question, no prices, and a stale phase (e.g.
 * "secondary" for a resolved market).
 */
export function isPartialMarket(m: Market): boolean {
  return !m.title && m.yesPrice == null && m.noPrice == null;
}

/** Rough completeness score used to never let a thinner record win. */
export function marketCompleteness(m: Market | null | undefined): number {
  if (!m) return -1;
  let n = 0;
  if (m.title) n += 4;
  if (m.yesPrice != null || m.noPrice != null) n += 4;
  if (m.secondaryYesPrice != null || m.secondaryNoPrice != null) n += 2;
  if (m.description || m.resolutionRule) n += 2;
  if (m.volumeUsdc || m.totalVolumeUsdc) n += 1;
  if (m.phase) n += 1;
  if (m.images?.length) n += 1;
  return n;
}

/** Keep `prev` when `next` is partial and thinner; otherwise take `next`. */
export function preferFuller(prev: Market | null | undefined, next: Market): Market {
  if (!prev) return next;
  if (isPartialMarket(next) && marketCompleteness(prev) > marketCompleteness(next)) return prev;
  return next;
}

/**
 * Merge a list row with its detail record for display. Detail wins field by
 * field when present; a partial detail only fills gaps.
 */
export function mergeMarket(list: Market, detail: Market | null | undefined): Market {
  if (!detail) return list;
  const partial = isPartialMarket(detail);
  const pick = <T>(d: T | null | undefined, l: T | null | undefined) =>
    d !== undefined && d !== null && d !== "" ? d : l;
  return {
    ...list,
    title: detail.title || list.title,
    description: pick(detail.description, list.description) ?? undefined,
    resolutionRule: pick(detail.resolutionRule, list.resolutionRule) ?? undefined,
    images: detail.images?.length ? detail.images : list.images,
    oracle: pick(detail.oracle, list.oracle) ?? null,
    volumeUsdc: pick(detail.volumeUsdc, list.volumeUsdc) ?? undefined,
    totalVolumeUsdc: pick(detail.totalVolumeUsdc, list.totalVolumeUsdc) ?? undefined,
    yesPrice: pick(detail.yesPrice, list.yesPrice) ?? null,
    noPrice: pick(detail.noPrice, list.noPrice) ?? null,
    primaryYesPrice: pick(detail.primaryYesPrice, list.primaryYesPrice) ?? null,
    primaryNoPrice: pick(detail.primaryNoPrice, list.primaryNoPrice) ?? null,
    secondaryYesPrice: pick(detail.secondaryYesPrice, list.secondaryYesPrice) ?? null,
    secondaryNoPrice: pick(detail.secondaryNoPrice, list.secondaryNoPrice) ?? null,
    // A partial detail carries a stale phase; only trust a full record's.
    // A row read from the market's on-chain account already has the
    // authoritative lifecycle, so it keeps it.
    phase: partial || list.sources?.chain ? list.phase || detail.phase : detail.phase || list.phase,
    status: partial || list.sources?.chain ? list.status || detail.status : detail.status || list.status,
    resolved:
      partial || list.sources?.chain ? (list.resolved ?? detail.resolved) : (detail.resolved ?? list.resolved),
    primaryPhaseEndTime: pick(detail.primaryPhaseEndTime, list.primaryPhaseEndTime) ?? null,
    category: detail.category || list.category,
  };
}

export const DETAIL_RETRY_MS = [400, 900] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a market detail via `getRaw`, retrying a partial record up to
 * DETAIL_RETRY_MS.length times with short backoff. Shared by the browser data
 * layer and the server brief route. Returns null when unparseable.
 */
export async function fetchMarketWithRetry(
  getRaw: () => Promise<unknown>,
  retryMs: readonly number[] = DETAIL_RETRY_MS,
): Promise<Market | null> {
  let best: Market | null = parseMarket(await getRaw());
  for (const delay of retryMs) {
    if (!best || !isPartialMarket(best)) break;
    await sleep(delay);
    const next = parseMarket(await getRaw());
    if (next) best = preferFuller(best, next);
  }
  if (best && isPartialMarket(best)) best = { ...best, partial: true };
  return best;
}

// ---------------------------------------------------------------------------
// Browser fetchers (via the /api/panta proxy)
// ---------------------------------------------------------------------------

export type MarketListParams = {
  category?: string;
  status?: string;
  limit?: number;
  cursor?: string | null;
};

export async function fetchMarketPage(params: MarketListParams = {}): Promise<MarketPage> {
  const { data } = await pantaFetch("/markets/", {
    query: {
      category: params.category || undefined,
      status: params.status || undefined,
      limit: params.limit ? String(params.limit) : undefined,
      cursor: params.cursor || undefined,
    },
  });
  return parseMarketPage(data);
}

export async function fetchMarket(marketId: string): Promise<Market | null> {
  const path = `/markets/${encodeURIComponent(marketId)}/`;
  return fetchMarketWithRetry(async () => (await pantaFetch(path)).data);
}

export async function fetchMarketTrades(marketId: string): Promise<TapePage> {
  const { data } = await pantaFetch(`/markets/${encodeURIComponent(marketId)}/trades/`);
  // Errors propagate (TanStack keeps them as errors, never as an empty tape).
  return parseTradesStrict(data);
}

export async function fetchCategories(): Promise<string[]> {
  const { data } = await pantaFetch("/categories/");
  return parseCategories(data);
}

/**
 * Full catalog from our own server route (REST list union + on-chain Event
 * accounts + detail for live markets). Rows are re-parsed so a bad row can't
 * reach components.
 */
export async function fetchCatalog(): Promise<CatalogPayload> {
  const res = await fetch("/api/catalog", { headers: { Accept: "application/json" } });
  const json = (await res.json().catch(() => null)) as (CatalogPayload & { detail?: string; code?: string }) | null;
  if (!res.ok || !json || !Array.isArray(json.items)) {
    throw new ApiError(res.status, (json ?? { code: "CATALOG_UNAVAILABLE" }) as unknown as Json);
  }
  const items: Market[] = [];
  for (const row of json.items) {
    const m = parseMarket(row);
    if (!m) continue;
    const src = (row as { sources?: Market["sources"] }).sources;
    items.push(src ? { ...m, sources: src } : m);
  }
  return { ...json, items };
}
