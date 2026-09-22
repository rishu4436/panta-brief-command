"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { pantaFetch } from "@/lib/api";
import {
  catalogVolume,
  formatRelativeTime,
  formatTapeSize,
  marketLabel,
  shortAddr,
} from "@/lib/format";
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

function activityScore(m: MarketCatalogItem): number {
  const vol = catalogVolume(m);
  const volN =
    vol == null ? 0 : typeof vol === "string" ? Number(vol) : Number(vol);
  const hasLabel =
    Boolean((m.title || "").trim()) || Boolean((m.description || "").trim())
      ? 50
      : 0;
  const phase = (m.phase || "").toLowerCase();
  const phaseBoost =
    phase === "primary" ? 20 : phase === "secondary" ? 10 : phase === "resolved" ? 2 : 0;
  return (Number.isFinite(volN) ? volN : 0) + hasLabel + phaseBoost;
}

/**
 * Lite cross-market tape for currently visible/watched ids.
 * Hard-caps parallel /trades/ fetches at 3 to stay rate-limit safe.
 * Prefers books with volume / human labels so the rail doesn't look dead.
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

    // Watched first (operator intent), then activity-ranked visible set
    for (const id of watchIds) {
      if (seen.has(id)) continue;
      const m = byId.get(id);
      if (m) {
        ordered.push(m);
        seen.add(id);
      }
      if (ordered.length >= MAX_PARALLEL) break;
    }

    const ranked = [...markets]
      .filter((m) => !seen.has(m.marketId))
      .sort((a, b) => activityScore(b) - activityScore(a));

    for (const m of ranked) {
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
  const [scanned, setScanned] = useState(0);

  useEffect(() => {
    if (targets.length === 0) {
      setHits([]);
      setScanned(0);
      setSkipped("No visible markets to scan yet.");
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
        setScanned(targets.length);
        if (merged.length === 0) {
          setSkipped(
            `Quiet on ${targets.length} scanned book${targets.length === 1 ? "" : "s"} — no recent prints yet.`,
          );
        }
      } catch {
        if (!cancelled) {
          setHits([]);
          setScanned(0);
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

  const now = Date.now();

  return (
    <Panel
      title="Hot tape"
      action={
        <span className="font-num text-[9px] text-zinc-600">
          ≤{MAX_PARALLEL} mkts
          {scanned > 0 ? ` · ${scanned} scanned` : ""}
        </span>
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
            <div className="text-[12px] text-zinc-400">Tape quiet</div>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
              {skipped}
            </p>
            <p className="mt-2 text-[10px] text-zinc-700">
              No invented prints — open a market with volume to watch live flow.
            </p>
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
                    {formatRelativeTime(h.trade.blockTime, now)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-300">{h.label}</div>
                <div className="mt-0.5 flex justify-between font-num text-[10px] text-zinc-600">
                  <span>{formatTapeSize(h.trade)}</span>
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
