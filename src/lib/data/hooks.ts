"use client";

/**
 * Shared client data layer (TanStack Query). Components read Panta data only
 * through these hooks, so:
 * - the catalog / details / tape / ledger are cached and deduped across views;
 * - a partial market detail never overwrites a fuller cached record;
 * - list rows hydrate details only when near the viewport, ≤4 at a time.
 */

import {
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, PublicKey } from "@solana/web3.js";
import { fetchAccountTrades } from "@/lib/panta/attribution";
import {
  filterCatalog,
  resolveAuthoritativeMarket,
  selectMergedMarket,
  type CatalogFilter,
} from "@/lib/panta/catalog";
import { preferFuller } from "@/lib/panta/markets";
import type { Market } from "@/lib/panta/domain";
import {
  fetchCatalog,
  fetchCategories,
  fetchMarket,
  fetchMarketTrades,
} from "@/lib/panta/markets";
import { fetchPositions } from "@/lib/panta/positions";
import { ApiError } from "@/lib/panta/client";
import type { BriefMode, BriefPayload, Json } from "@/lib/types";
import { createLimiter } from "./limit";

/** Max concurrent detail fetches for list/book hydration. */
export const HYDRATION_CONCURRENCY = 4;
const hydrate = createLimiter(HYDRATION_CONCURRENCY);

export type { CatalogFilter };

export const qk = {
  catalog: () => ["catalog"] as const,
  market: (id: string) => ["market", id] as const,
  trades: (id: string) => ["trades", id] as const,
  categories: () => ["categories"] as const,
  positions: (wallet: string) => ["positions", wallet] as const,
  accountTrades: (limit: number, kind: string) => ["accountTrades", { limit, kind }] as const,
  brief: (id: string, mode: BriefMode, nonce: number) => ["brief", id, mode, nonce] as const,
  usdc: (wallet: string) => ["usdc", wallet] as const,
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * The full catalog (one cached server payload for every view); `filter` is
 * applied client-side. There is no paging: /api/catalog already merges every
 * reachable market (see src/lib/panta/catalog-server.ts).
 */
export function useCatalog(filter: CatalogFilter = {}, opts: { enabled?: boolean } = {}) {
  const q = useQuery({
    queryKey: qk.catalog(),
    queryFn: fetchCatalog,
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
  const { category, status } = filter;
  const items = useMemo(
    () => filterCatalog(q.data?.items ?? [], { category, status }),
    [q.data, category, status],
  );
  return { ...q, items, counts: q.data?.counts ?? null, sources: q.data?.sources ?? null };
}

export function useCategories() {
  return useQuery({ queryKey: qk.categories(), queryFn: fetchCategories, staleTime: 10 * 60_000 });
}


// ---------------------------------------------------------------------------
// Market detail
// ---------------------------------------------------------------------------

/**
 * Raw market-detail query fn. Stores the Panta detail record (preferFuller
 * against a prior raw cache entry) WITHOUT catalog merge — so useMarket can
 * re-merge when the catalog query later arrives (direct /markets/[id] nav).
 */
async function loadMarket(qc: QueryClient, id: string): Promise<Market> {
  const prev = qc.getQueryData<Market>(qk.market(id));
  const next = await fetchMarket(id);
  if (!next) {
    // Keep a previously cached raw detail; otherwise fail (catalog-only shown via useMarket merge).
    if (prev) return prev;
    throw new Error("MARKET_NOT_FOUND");
  }
  return preferFuller(prev, next);
}

/**
 * One deterministic market for the detail page: subscribe to the shared catalog
 * cache (same key/options as useCatalog — no duplicate request) and re-merge
 * with the raw detail whenever either side updates.
 */
export function useMarket(id: string) {
  const qc = useQueryClient();
  const catalogQ = useQuery({
    queryKey: qk.catalog(),
    queryFn: fetchCatalog,
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  const detailQ = useQuery({
    queryKey: qk.market(id),
    queryFn: () => loadMarket(qc, id),
    enabled: Boolean(id),
  });
  const data = useMemo(
    () => selectMergedMarket(catalogQ.data?.items, id, detailQ.data) ?? undefined,
    [catalogQ.data?.items, id, detailQ.data],
  );
  return {
    ...detailQ,
    data,
    /** True only while we have nothing to show (no catalog row and no detail yet). */
    isPending: !data && (detailQ.isPending || catalogQ.isPending),
    isFetching: detailQ.isFetching || catalogQ.isFetching,
  };
}

/** @internal test helper — same merge useMarket applies. */
export { selectMergedMarket, resolveAuthoritativeMarket };

/**
 * Module-level (stable) combiner: TanStack only recomputes the id → detail map
 * when a detail result actually changes, so consumers get a stable Map.
 */
function detailsById(results: { data?: Market }[]): Map<string, Market> {
  const map = new Map<string, Market>();
  for (const r of results) if (r.data) map.set(r.data.marketId, r.data);
  return map;
}

/** List rows that lack a human label or context benefit from the detail record. */
export function needsDetail(m: Market): boolean {
  return !m.title || (m.description || m.resolutionRule || "").length < 24;
}

/**
 * Detail records for `markets`, fetched only for ids in `visible` (and only
 * when the row needs them), through the shared ≤4 concurrency limiter.
 * Returns id → detail for whatever is cached.
 */
export function useHydratedDetails(markets: Market[], visible: ReadonlySet<string>) {
  const qc = useQueryClient();
  // Share the catalog cache (no extra polling); merge so consumers never see raw-only priceless detail.
  const catalogQ = useQuery({
    queryKey: qk.catalog(),
    queryFn: fetchCatalog,
    staleTime: 60_000,
  });
  const raw = useQueries({
    queries: markets.map((m) => ({
      queryKey: qk.market(m.marketId),
      queryFn: () => hydrate(() => loadMarket(qc, m.marketId)),
      enabled: visible.has(m.marketId) && needsDetail(m),
      staleTime: 5 * 60_000,
      retry: 0,
    })),
    combine: detailsById,
  });
  return useMemo(() => {
    const map = new Map<string, Market>();
    for (const [id, detail] of raw) {
      map.set(id, selectMergedMarket(catalogQ.data?.items, id, detail) ?? detail);
    }
    return map;
  }, [raw, catalogQ.data?.items]);
}

/**
 * Book hydration: one detail per position market (for marks/titles).
 * Intentional bounded hydration — Panta has no batch detail endpoint
 * (docs.panta.market markets catalog: list / get / trades / categories /
 * wallet trades only), so this is capped at `max` markets and runs through the
 * same ≤4 limiter and cache as the catalog.
 */
export function useMarketDetails(ids: string[], max = 12) {
  const qc = useQueryClient();
  const capped = useMemo(() => Array.from(new Set(ids)).slice(0, max), [ids, max]);
  const catalogQ = useQuery({
    queryKey: qk.catalog(),
    queryFn: fetchCatalog,
    staleTime: 60_000,
  });
  const raw = useQueries({
    queries: capped.map((id) => ({
      queryKey: qk.market(id),
      queryFn: () => hydrate(() => loadMarket(qc, id)),
      staleTime: 60_000,
      retry: 0,
    })),
    combine: detailsById,
  });
  return useMemo(() => {
    const map = new Map<string, Market>();
    for (const [id, detail] of raw) {
      map.set(id, selectMergedMarket(catalogQ.data?.items, id, detail) ?? detail);
    }
    return map;
  }, [raw, catalogQ.data?.items]);
}

// ---------------------------------------------------------------------------
// Tape
// ---------------------------------------------------------------------------

export function useMarketTrades(id: string) {
  return useQuery({
    queryKey: qk.trades(id),
    queryFn: () => fetchMarketTrades(id),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

/** Tape for several markets (hot tape rail), sharing the per-market cache. */
export function useTradesFor(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.trades(id),
      queryFn: () => fetchMarketTrades(id),
      staleTime: 15_000,
      retry: 0,
    })),
  });
}

// ---------------------------------------------------------------------------
// Book / attribution
// ---------------------------------------------------------------------------

export function usePositions(wallet: string | null) {
  return useQuery({
    queryKey: qk.positions(wallet || ""),
    queryFn: () => fetchPositions(wallet!),
    enabled: Boolean(wallet),
  });
}

export function useAccountTrades(limit: number, kind: "buy" | "claim" | "") {
  return useQuery({
    queryKey: qk.accountTrades(limit, kind),
    queryFn: () => fetchAccountTrades({ limit, kind }),
    staleTime: 10_000,
  });
}

/** Refresh every Activity view after a report / ledger hit. */
export function useInvalidateAttribution() {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["accountTrades"] });
  }, [qc]);
}

/** Wallet USDC balance chip (mainnet USDC mint). */
export function useUsdcBalance(connection: Connection, owner: PublicKey | null, mint: PublicKey) {
  return useQuery({
    queryKey: qk.usdc(owner?.toBase58() || ""),
    enabled: Boolean(owner),
    staleTime: 30_000,
    queryFn: async () => {
      const res = await connection.getParsedTokenAccountsByOwner(owner!, { mint });
      let total = 0;
      for (const acc of res.value) {
        const amt = acc.account.data.parsed?.info?.tokenAmount?.uiAmount;
        if (typeof amt === "number" && Number.isFinite(amt)) total += amt;
      }
      return total;
    },
  });
}

// ---------------------------------------------------------------------------
// AI brief
// ---------------------------------------------------------------------------

export class BriefRateLimitError extends Error {
  constructor(public retryAt: number) {
    super("RATE_LIMITED");
  }
}

async function fetchBrief(marketId: string, mode: BriefMode): Promise<BriefPayload> {
  const res = await fetch("/api/brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Server fetches + parses market/tape and computes signals itself.
    body: JSON.stringify({ marketId, mode }),
  });
  const json = (await res.json().catch(() => ({}))) as BriefPayload & {
    code?: string;
    detail?: string;
  };
  if (res.status === 429) {
    const sec = Number(res.headers.get("retry-after") || "60");
    throw new BriefRateLimitError(Date.now() + (Number.isFinite(sec) ? sec : 60) * 1000);
  }
  // Body kept on the error so describeErr maps the code to readable text.
  if (!res.ok) throw new ApiError(res.status, json as unknown as Json);
  return json;
}

export function useBrief(marketId: string, mode: BriefMode, nonce: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.brief(marketId, mode, nonce),
    queryFn: () => fetchBrief(marketId, mode),
    enabled: enabled && Boolean(marketId),
    staleTime: Infinity,
    retry: false,
    // Keep the previous brief for the same market on screen while a mode loads.
    placeholderData: (prev: BriefPayload | undefined) =>
      prev && prev.market.marketId === marketId ? prev : undefined,
  });
}

// ---------------------------------------------------------------------------
// Viewport tracking for hydration
// ---------------------------------------------------------------------------

/**
 * One IntersectionObserver for a list. `track(id)` returns a ref callback for
 * a row; `visible` holds ids within ~1 screen of the viewport.
 */
export function useViewportIds(rootMargin = "400px 0px") {
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set());
  const observer = useRef<IntersectionObserver | null>(null);
  const nodes = useRef(new Map<string, Element>());

  const getObserver = useCallback(() => {
    if (observer.current || typeof IntersectionObserver === "undefined") return observer.current;
    observer.current = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.marketId;
            if (!id) continue;
            // Sticky: once near the viewport, keep it (details are cached anyway).
            if (e.isIntersecting && !next.has(id)) {
              next.add(id);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { rootMargin },
    );
    return observer.current;
  }, [rootMargin]);

  useEffect(() => () => observer.current?.disconnect(), []);

  const track = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      const obs = getObserver();
      const prev = nodes.current.get(id);
      if (prev && prev !== el) obs?.unobserve(prev);
      if (el) {
        el.dataset.marketId = id;
        nodes.current.set(id, el);
        obs?.observe(el);
      } else {
        nodes.current.delete(id);
      }
    },
    [getObserver],
  );

  return { visible, track };
}
