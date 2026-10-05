import "server-only";

/**
 * Server-side catalog builder behind GET /api/catalog.
 *
 * 1. Panta REST list: union of every status × category filter (the list caps
 *    at 50 rows and its nextCursor returns page 1 again, so paging is useless).
 * 2. On-chain: one getProgramAccounts call for all `Event` accounts of the
 *    Panta program (finds the markets the list omits, with question text,
 *    end time and lifecycle flags).
 * 3. Panta detail for every live / not-yet-final market (prices, category).
 *
 * Budget: Panta's read limit is 120 req / 60 s per key, so the result is
 * cached in memory for CATALOG_TTL_MS and at the CDN (see the route).
 */

import { createLimiter } from "@/lib/data/limit";
import { serverRpcUrl } from "@/lib/rpc";
import {
  EVENT_DISCRIMINATOR_B58,
  PANTA_PROGRAM_ID,
  decodeEventAccount,
  type ChainEvent,
} from "./chain-events";
import {
  countLifecycles,
  lifecycleRank,
  mergeCatalog,
  sortCatalog,
  resolveAuthoritativeMarket,
  withDetail,
  type CatalogPayload,
} from "./catalog";
import type { Market } from "./domain";
import { fetchMarketWithRetry, parseCategories, parseMarketPage } from "./markets";
import { getMarketServer, pantaServerGet, UpstreamError } from "./server";

export const CATALOG_TTL_MS = 120_000;
const LIST_LIMIT = 50;
const MAX_DETAIL = 40;
const RPC_TIMEOUT_MS = 20_000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

async function listUnion(): Promise<{ rows: Market[]; requests: number; error?: string }> {
  const limit = createLimiter(4);
  let requests = 0;
  let gets = 0;
  let failures = 0;
  let lastError = "";
  const get = (q: Record<string, string>) =>
    limit(async () => {
      requests += 1;
      gets += 1;
      const qs = new URLSearchParams({ ...q, limit: String(LIST_LIMIT) }).toString();
      try {
        return parseMarketPage(await pantaServerGet(`/markets/?${qs}`)).items;
      } catch (e) {
        failures += 1;
        lastError = errText(e);
        return [] as Market[];
      }
    });

  let categories: string[] = [];
  try {
    requests += 1;
    categories = parseCategories(await pantaServerGet("/categories/"));
  } catch (e) {
    lastError = errText(e);
  }
  const base = await Promise.all([
    get({}),
    get({ status: "primary" }),
    get({ status: "secondary" }),
    ...categories.map((category) => get({ category })),
  ]);
  // A category page that hit the cap may hide more rows behind the phase split.
  const capped = categories.filter((_, i) => base[3 + i].length >= LIST_LIMIT);
  const extra = await Promise.all(
    capped.flatMap((category) => [get({ category, status: "primary" }), get({ category, status: "secondary" })]),
  );
  const rows = [...base, ...extra].flat();
  const error = gets > 0 && failures === gets ? lastError || "list unavailable" : undefined;
  return { rows, requests, error };
}

async function chainEvents(): Promise<ChainEvent[]> {
  const endpoint = serverRpcUrl();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getProgramAccounts",
      params: [
        PANTA_PROGRAM_ID,
        { encoding: "base64", commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: EVENT_DISCRIMINATOR_B58 } }] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: { pubkey: string; account: { data: [string, string] } }[];
    error?: { message?: string };
  };
  if (!Array.isArray(json.result)) throw new Error(json.error?.message || "RPC returned no result");
  const out: ChainEvent[] = [];
  for (const a of json.result) {
    const ev = decodeEventAccount(a.pubkey, Buffer.from(a.account.data[0], "base64"));
    if (ev) out.push(ev);
  }
  return out;
}

export async function buildCatalog(): Promise<CatalogPayload> {
  const [list, chain] = await Promise.all([
    listUnion(),
    chainEvents().then(
      (events) => ({ events, error: undefined as string | undefined }),
      (e: unknown) => ({ events: null as ChainEvent[] | null, error: errText(e) }),
    ),
  ]);
  if (list.error && !chain.events) throw new Error(`catalog unavailable: ${list.error}; chain: ${chain.error}`);

  const listIds = new Set(list.rows.map((m) => m.marketId));
  const chainIds = new Set((chain.events ?? []).map((e) => e.marketId));
  // With a complete on-chain enumeration, a list row that has no Event
  // account on mainnet is not a tradable market (seen live: registry rows
  // pointing at a program that only exists on devnet). They are counted in
  // `sources.listOnly` and left out rather than shown as open.
  const listRows = chain.events ? list.rows.filter((m) => chainIds.has(m.marketId)) : list.rows;
  let items = mergeCatalog(listRows, chain.events);

  // Detail for every market that is not final yet (live or awaiting a result).
  const now = Math.floor(Date.now() / 1000);
  const targets = sortCatalog(items, now)
    .filter((m) => lifecycleRank(m, now) <= 3)
    .slice(0, MAX_DETAIL);
  const limit = createLimiter(5);
  const details = new Map<string, Market>();
  await Promise.all(
    targets.map((m) =>
      limit(async () => {
        try {
          const path = `/markets/${encodeURIComponent(m.marketId)}/`;
          // Short retry budget: a partial record just leaves the chain/list row in place.
          const d = await fetchMarketWithRetry(() => pantaServerGet(path, 6_000), [300, 600]);
          if (d && !d.partial) details.set(m.marketId, d);
        } catch {
          /* keep the list / chain row */
        }
      }),
    ),
  );
  items = sortCatalog(
    items.map((m) => withDetail(m, details.get(m.marketId))),
    now,
  );

  return {
    items,
    counts: countLifecycles(items, now),
    sources: {
      listUnique: listIds.size,
      listRequests: list.requests,
      chainAccounts: chain.events ? chain.events.length : null,
      chainOnly: [...chainIds].filter((id) => !listIds.has(id)).length,
      listOnly: chain.events ? [...listIds].filter((id) => !chainIds.has(id)).length : 0,
      detailHydrated: details.size,
      ...(chain.error ? { chainError: chain.error } : {}),
      ...(list.error ? { listError: list.error } : {}),
    },
    generatedAt: new Date().toISOString(),
  };
}

let cached: { at: number; payload: CatalogPayload } | null = null;
let inflight: Promise<CatalogPayload> | null = null;

/**
 * Market view for /api/brief (and any other server reader that must match the
 * catalog): the cached catalog/on-chain row merged with a fresh detail fetch.
 * A partial Panta detail (no title/prices, stale phase) never overwrites the
 * authoritative lifecycle. Falls back to detail alone only when the catalog
 * has no row for this id; returns null when both are missing.
 */
export async function getAuthoritativeMarket(marketId: string): Promise<Market | null> {
  let row: Market | undefined;
  try {
    const { payload } = await getCatalog();
    row = payload.items.find((m) => m.marketId === marketId);
  } catch {
    /* catalog unavailable — try detail alone */
  }
  let detail: Market | null = null;
  try {
    detail = await getMarketServer(marketId);
  } catch (e) {
    if (e instanceof UpstreamError) {
      if (!row) throw e;
      // Keep the catalog row when detail is temporarily unreachable.
    } else {
      throw e;
    }
  }
  return resolveAuthoritativeMarket(row, detail);
}

/** Cached build (per server instance). Serves the last good payload if a rebuild fails. */
export async function getCatalog(): Promise<{ payload: CatalogPayload; stale: boolean }> {
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return { payload: cached.payload, stale: false };
  inflight ??= buildCatalog().finally(() => {
    inflight = null;
  });
  try {
    const payload = await inflight;
    cached = { at: Date.now(), payload };
    return { payload, stale: false };
  } catch (e) {
    if (cached) return { payload: cached.payload, stale: true };
    throw e;
  }
}
