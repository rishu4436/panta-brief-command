"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import { formatVolumeUsdc } from "@/lib/format";
import type {
  CategoriesResponse,
  MarketCatalogItem,
  MarketsListResponse,
} from "@/lib/types";
import { GlassCard } from "./GlassCard";
import { PhaseBadge } from "./PhaseBadge";

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

  return (
    <GlassCard
      title="Market catalog"
      action={
        <button
          type="button"
          onClick={() => void loadMarkets()}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
          disabled={busy}
        >
          {busy ? "Syncing…" : "Refresh"}
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter title / id…"
          className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-cyan-400/40 focus:ring"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
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
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        >
          <option value="">All phases</option>
          <option value="primary">primary</option>
          <option value="secondary">secondary</option>
          <option value="resolved">resolved</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
          <div className="mt-1 text-[11px] text-rose-200/70">
            Set <code className="text-rose-100">PANTA_API_KEY</code> in{" "}
            <code className="text-rose-100">.env.local</code> and restart.
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-white/5">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 font-medium">Phase</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">
                Volume
              </th>
              <th className="px-3 py-2 font-medium">Odds</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr
                key={m.marketId}
                className="border-t border-white/5 hover:bg-white/[0.03]"
              >
                <td className="px-3 py-3">
                  <Link
                    href={`/markets/${encodeURIComponent(m.marketId)}`}
                    className="font-medium text-zinc-100 hover:text-cyan-300"
                  >
                    {m.title}
                  </Link>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {m.category} · {m.marketId.slice(0, 8)}…
                  </div>
                </td>
                <td className="px-3 py-3">
                  <PhaseBadge phase={m.phase} />
                </td>
                <td className="hidden px-3 py-3 text-zinc-400 sm:table-cell">
                  {formatVolumeUsdc(m.volumeUsdc)}
                </td>
                <td className="px-3 py-3 text-[11px] text-zinc-500">
                  Detail for odds
                </td>
              </tr>
            ))}
            {!busy && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-sm text-zinc-500"
                >
                  No markets loaded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void loadMarkets({ append: true, cursor: nextCursor })
            }
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            Load more
          </button>
        </div>
      )}
    </GlassCard>
  );
}
