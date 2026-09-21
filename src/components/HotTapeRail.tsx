"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { pantaFetch } from "@/lib/api";
import { formatBlockTime, formatVolumeUsdc, marketLabel, shortAddr } from "@/lib/format";
import type { CatalogTradeRow, MarketCatalogItem, MarketTradesResponse } from "@/lib/types";
import { Panel } from "./Panel";

type TapeHit = {
  marketId: string;
  label: string;
  trade: CatalogTradeRow;
};

const MAX_PARALLEL = 3;
const MAX_ROWS = 18;

function tradeSide(t: CatalogTradeRow): string {
  if (t.side) return t.side.toUpperCase();
  const y = Number(t.yesAmount ?? 0);
  const n = Number(t.noAmount ?? 0);
  if (y > n) return "YES";
  if (n > y) return "NO";
  return "—";
}

function tradeSize(t: CatalogTradeRow): string {
  if (t.amountUsdc) return formatVolumeUsdc(t.amountUsdc);
  return `Y${t.yesAmount ?? "—"}/N${t.noAmount ?? "—"}`;
}

/**
 * Lite cross-market tape for currently visible/watched ids.
 * Hard-caps parallel /trades/ fetches at 3 to stay rate-limit safe.
 */
export function HotTapeRail({
  markets,
  watchIds = [],
}: {
  markets: MarketCatalogItem[];
  watchIds?: string[];
}) {
  const targets = useMemo(() => {
    const byId = new Map(markets.map((m) => [m.marketId, m]));
    const ordered: MarketCatalogItem[] = [];
    const seen = new Set<string>();
    for (const id of watchIds) {
      if (seen.has(id)) continue;
      const m = byId.get(id);
      if (m) {
        ordered.push(m);
        seen.add(id);
      }
      if (ordered.length >= MAX_PARALLEL) break;
    }
    for (const m of markets) {
      if (seen.has(m.marketId)) continue;
      ordered.push(m);
      seen.add(m.marketId);
      if (ordered.length >= MAX_PARALLEL) break;
    }
    return ordered.slice(0, MAX_PARALLEL);
  }, [markets, watchIds]);

  const targetKey = targets.map((m) => m.marketId).join("|");
  const [hits, setHits] = useState<TapeHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<string | null>(null);

  useEffect(() => {
    if (targets.length === 0) {
      setHits([]);
      setSkipped("No visible markets to fan-out yet.");
      return;
    }
    let cancelled = false;
    setBusy(true);
    setSkipped(null);

    (async () => {
      try {
        const batches = await Promise.all(
          targets.map(async (m) => {
            try {
              const { data } = await pantaFetch<MarketTradesResponse>(
                `/markets/${encodeURIComponent(m.marketId)}/trades/`,
              );
              const items = (data.items || []).slice(0, 6);
              return items.map((trade) => ({
                marketId: m.marketId,
                label: marketLabel(m, { max: 36 }),
                trade,
              }));
            } catch {
              return [] as TapeHit[];
            }
          }),
        );
        if (cancelled) return;
        const merged = batches
          .flat()
          .sort((a, b) => (b.trade.blockTime ?? 0) - (a.trade.blockTime ?? 0))
          .slice(0, MAX_ROWS);
        setHits(merged);
        if (merged.length === 0) {
          setSkipped("No recent prints on watched/visible set (≤3 markets).");
        }
      } catch {
        if (!cancelled) {
          setHits([]);
          setSkipped("Hot tape skipped — trade fan-out unavailable.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  return (
    <Panel
      title="Hot tape"
      action={
        <span className="font-num text-[9px] text-zinc-600">≤{MAX_PARALLEL} mkts</span>
      }
      flush
    >
      <div className="max-h-[min(70vh,520px)] overflow-y-auto">
        {busy && hits.length === 0 && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        )}
        {!busy && skipped && hits.length === 0 && (
          <div className="px-3.5 py-8 text-center">
            <div className="text-[12px] text-zinc-500">Tape quiet</div>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{skipped}</p>
          </div>
        )}
        <div className="divide-y divide-[#1f1f23]">
          {hits.map((h, i) => {
            const side = tradeSide(h.trade);
            const sideColor =
              side === "YES"
                ? "text-emerald-400"
                : side === "NO"
                  ? "text-rose-400"
                  : "text-zinc-500";
            return (
              <Link
                key={`${h.marketId}-${h.trade.signature || h.trade.id || i}`}
                href={`/markets/${encodeURIComponent(h.marketId)}`}
                className="block px-3.5 py-2 transition hover:bg-[#161618] focus-visible:bg-[#161618]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-num text-[11px] font-semibold ${sideColor}`}>
                    {side}
                  </span>
                  <span className="font-num text-[10px] text-zinc-500">
                    {formatBlockTime(h.trade.blockTime)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-300">{h.label}</div>
                <div className="mt-0.5 flex justify-between font-num text-[10px] text-zinc-600">
                  <span>{tradeSize(h.trade)}</span>
                  <span>{shortAddr(h.trade.wallet, 3)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
