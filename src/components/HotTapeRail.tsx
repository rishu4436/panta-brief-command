"use client";

import { useMemo } from "react";
import { useNow } from "@/hooks/useNow";
import Link from "next/link";
import { useTradesFor } from "@/lib/data/hooks";
import {
  catalogVolume,
  formatRelativeTime,
  formatTapeSize,
  marketLabel,
  shortAddr,
} from "@/lib/format";
import type { Market, Trade } from "@/lib/panta/domain";
import { Panel } from "./Panel";

type TapeHit = {
  marketId: string;
  label: string;
  trade: Trade;
};

const MAX_PARALLEL = 3;
const MAX_ROWS = 18;

function tradeSide(t: Trade): string {
  return t.side ? t.side.toUpperCase() : "—";
}

function activityScore(m: Market): number {
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
  catalogState = "ready",
}: {
  markets: Market[];
  watchIds?: string[];
  /** Catalog status from the desk, so the rail doesn't read "quiet" while it is loading or down. */
  catalogState?: "loading" | "error" | "ready";
}) {
  const targets = useMemo(() => {
    const byId = new Map(markets.map((m) => [m.marketId, m]));
    const ordered: Market[] = [];
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

  // Shared per-market tape cache (same entries MarketDetail uses).
  const queries = useTradesFor(targets.map((m) => m.marketId));
  const busy = catalogState === "loading" || queries.some((q) => q.isPending && q.fetchStatus !== "idle");
  const settled = queries.filter((q) => q.isSuccess || q.isError).length;
  const allFailed = queries.length > 0 && queries.every((q) => q.isError);
  const hits = useMemo(() => {
    const out: TapeHit[] = [];
    targets.forEach((m, i) => {
      for (const trade of (queries[i]?.data ?? []).slice(0, 6)) {
        out.push({ marketId: m.marketId, label: marketLabel(m, { max: 36 }), trade });
      }
    });
    return out.sort((a, b) => (b.trade.blockTime ?? 0) - (a.trade.blockTime ?? 0)).slice(0, MAX_ROWS);
  }, [targets, queries]);
  const scanned = settled;
  const skipped =
    catalogState === "error" && targets.length === 0
      ? "Waiting for the market catalog to load."
      : targets.length === 0
      ? "No visible markets to scan yet."
      : allFailed
        ? "Hot tape skipped — trade fan-out unavailable."
        : !busy && hits.length === 0
          ? `Quiet on ${targets.length} scanned book${targets.length === 1 ? "" : "s"} — no recent prints yet.`
          : null;

  const now = useNow(30_000);

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
            <div className="type-body text-zinc-400">{catalogState === "error" && targets.length === 0 ? "Tape unavailable" : "Tape quiet"}</div>
            <p className="type-meta mt-1 leading-relaxed">
              {skipped}
            </p>
            <p className="mt-2 text-[10px] text-zinc-700">
              No invented prints — open a market with volume to watch live flow.
            </p>
          </div>
        )}
        <div className="divide-y divide-line">
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
                className="block px-3 py-1.5 transition hover:bg-elevated focus-visible:bg-elevated"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-num text-[11px] font-semibold tabular-nums ${sideColor}`}>
                    {side}
                  </span>
                  <span className="font-num text-[10px] tabular-nums text-zinc-500">
                    {formatRelativeTime(h.trade.blockTime, now)}
                  </span>
                </div>
                <div
                  className={`mt-0.5 truncate text-[12px] leading-snug ${
                    h.label === "Untitled market" || h.label.startsWith("Untitled")
                      ? "italic text-zinc-500"
                      : "font-medium text-zinc-200"
                  }`}
                >
                  {h.label}
                </div>
                <div className="market-sub mt-0.5 flex justify-between font-num">
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
