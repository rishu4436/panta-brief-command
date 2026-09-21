"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import { formatVolumeUsdc, impliedSide } from "@/lib/format";
import type {
  CategoriesResponse,
  MarketCatalogItem,
  MarketsListResponse,
} from "@/lib/types";
import { Panel } from "./Panel";
import { PhaseBadge } from "./PhaseBadge";
import { ProbBar } from "./ProbBar";

function formatEnd(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isApiKeyError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("api key") ||
    m.includes("panta_api_key") ||
    m.includes("unauthorized") ||
    m.includes("401") ||
    m.includes("missing key") ||
    m.includes("x-api-key") ||
    m.includes("forbidden") ||
    m.includes("503")
  );
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-[#1f1f23]">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-4 w-3/4 max-w-md" />
            <div className="skeleton h-3 w-40" />
          </div>
          <div className="skeleton h-5 w-16" />
          <div className="hidden w-24 space-y-1.5 sm:block">
            <div className="skeleton h-5 w-16 ml-auto" />
            <div className="skeleton h-1.5 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SetupPanel({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-in">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400 text-lg font-black text-[#0a0a0b]">
        P
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight text-zinc-50">
        Connect Panta API
      </h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        Add your key to unlock the live market catalog.
      </p>
      <code className="mt-4 rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 font-num text-[12px] text-cyan-300">
        PANTA_API_KEY=pk_…
      </code>
      <p className="mt-3 max-w-md text-[11px] text-zinc-600">
        Place it in <span className="text-zinc-400">.env.local</span> and restart
        the dev server.
      </p>
      <p className="mt-4 max-w-lg truncate text-[10px] text-zinc-700">{error}</p>
      <a
        href="https://docs.panta.market/"
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition hover:bg-cyan-300"
      >
        Get API key →
      </a>
    </div>
  );
}

export function MarketList() {
  const [items, setItems] = useState<MarketCatalogItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [phase, setPhase] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const loadCategories = useCallback(async () => {
    try {
      const { data } = await pantaFetch<CategoriesResponse>("/categories/");
      setCategories(data.categories || []);
    } catch {
      /* optional */
    }
  }, []);

  const loadMarkets = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      setBusy(true);
      setError(null);
      try {
        const { data } = await pantaFetch<MarketsListResponse>("/markets/", {
          query: {
            category: category || undefined,
            status: phase || undefined,
            limit: "24",
            cursor: opts?.cursor || undefined,
          },
        });
        setItems((prev) =>
          opts?.append ? [...prev, ...(data.items || [])] : data.items || [],
        );
        setNextCursor(data.nextCursor ?? null);
      } catch (e) {
        setError(describeErr(e));
      } finally {
        setBusy(false);
      }
    },
    [category, phase],
  );

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  const filtered = q.trim()
    ? items.filter(
        (m) =>
          m.title.toLowerCase().includes(q.toLowerCase()) ||
          m.marketId.toLowerCase().includes(q.toLowerCase()) ||
          (m.category || "").toLowerCase().includes(q.toLowerCase()),
      )
    : items;

  const showSetup = error && items.length === 0 && isApiKeyError(error);
  const showSkeleton = busy && items.length === 0 && !error;

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-50">
            Markets
          </h1>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            USDC catalog · live odds when detail fills
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMarkets()}
          className="rounded-md border border-[#1f1f23] bg-[#111113] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-[#2a2a2e] hover:text-zinc-200"
          disabled={busy}
        >
          {busy ? "Syncing…" : "Refresh"}
        </button>
      </div>

      <Panel flush>
        <div className="flex flex-wrap gap-2 border-b border-[#1f1f23] px-3.5 py-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search markets…"
            className="min-w-[200px] flex-1 rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-300"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-300"
          >
            <option value="">All phases</option>
            <option value="primary">primary</option>
            <option value="secondary">secondary</option>
            <option value="resolved">resolved</option>
            <option value="cancelled">cancelled</option>
          </select>
        </div>

        {showSetup ? (
          <SetupPanel error={error!} />
        ) : (
          <>
            {error && !showSetup && (
              <div className="mx-3.5 mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}

            {showSkeleton ? (
              <SkeletonRows />
            ) : (
              <div className="divide-y divide-[#1f1f23]">
                {/* Header */}
                <div className="hidden grid-cols-[1fr_88px_100px_110px] gap-3 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600 sm:grid lg:grid-cols-[1fr_88px_100px_100px_110px]">
                  <span>Market</span>
                  <span>Phase</span>
                  <span className="hidden lg:inline">Volume</span>
                  <span className="text-right">Ends</span>
                  <span className="text-right">Prob</span>
                </div>

                {filtered.map((m) => {
                  const { yes, no } = impliedSide(m);
                  return (
                    <Link
                      key={m.marketId}
                      href={`/markets/${encodeURIComponent(m.marketId)}`}
                      className="group grid grid-cols-1 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[#161618] sm:grid-cols-[1fr_88px_100px_110px] lg:grid-cols-[1fr_88px_100px_100px_110px]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-zinc-100 group-hover:text-white">
                          {m.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-600">
                          <span className="rounded border border-[#1f1f23] px-1 py-px text-zinc-500">
                            {m.category || "—"}
                          </span>
                          <span className="font-num">
                            {m.marketId.slice(0, 8)}…
                          </span>
                        </div>
                      </div>
                      <div>
                        <PhaseBadge phase={m.phase} />
                      </div>
                      <div className="hidden font-num text-[12px] text-zinc-400 lg:block">
                        {formatVolumeUsdc(m.volumeUsdc)}
                      </div>
                      <div className="hidden text-right font-num text-[11px] text-zinc-500 sm:block">
                        {formatEnd(m.endTime)}
                      </div>
                      <div className="sm:text-right">
                        <ProbBar yes={yes} no={no} size="sm" showLabels />
                      </div>
                    </Link>
                  );
                })}

                {!busy && filtered.length === 0 && (
                  <div className="px-4 py-14 text-center">
                    <div className="text-sm text-zinc-500">No markets match</div>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      Adjust filters or refresh the catalog
                    </p>
                  </div>
                )}
              </div>
            )}

            {nextCursor && (
              <div className="flex justify-center border-t border-[#1f1f23] py-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void loadMarkets({ append: true, cursor: nextCursor })
                  }
                  className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-4 py-2 text-sm text-zinc-300 transition hover:border-[#2a2a2e] hover:text-zinc-100 disabled:opacity-40"
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
