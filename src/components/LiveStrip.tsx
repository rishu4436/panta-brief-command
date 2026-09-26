"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCatalog } from "@/lib/data/hooks";
import { catalogVolume, formatVolumeUsdc, impliedSide, isUntitledMarket, marketActivityRank, marketLabel } from "@/lib/format";
import type { Market } from "@/lib/panta/domain";
import { ProbBar } from "./ProbBar";
import { PhaseBadge } from "./PhaseBadge";

function SkeletonStrip() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3.5 w-3/4 max-w-sm" />
            <div className="skeleton h-2.5 w-24" />
          </div>
          <div className="skeleton h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

function StaticPreview() {
  return (
    <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
      {[
        { label: "YES", hint: "live %", color: "text-emerald-400" },
        { label: "Volume", hint: "USDC", color: "text-zinc-200" },
        { label: "NO", hint: "live %", color: "text-rose-400" },
      ].map((cell) => (
        <div key={cell.label} className="px-5 py-6">
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            {cell.label}
          </div>
          <div className={`mt-1 font-num text-2xl font-semibold ${cell.color}`}>
            ···
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">{cell.hint}</div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full w-1/2 rounded-full bg-current opacity-20 text-zinc-500" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LiveStrip() {
  // Shared catalog cache: the same queries back the desk and execute picker.
  const primary = useCatalog({ status: "primary" });
  const all = useCatalog({}, { enabled: primary.isFetched && primary.items.length < 3 });
  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: Market[] = [];
    for (const m of [...primary.items, ...(primary.items.length < 3 ? all.items : [])]) {
      if (seen.has(m.marketId)) continue;
      seen.add(m.marketId);
      merged.push(m);
    }
    // Prefer primary/active; demote cancelled/resolved in the strip.
    return merged.sort((a, b) => marketActivityRank(a) - marketActivityRank(b)).slice(0, 6);
  }, [primary.items, all.items]);
  const busy = primary.isPending || (primary.items.length < 3 && all.isPending && all.fetchStatus !== "idle");
  const failed = primary.isError && all.isError;

  const showLive = !busy && !failed && items.length > 0;
  const showPreview = !busy && (failed || items.length === 0);

  return (
    <div className="relative mx-auto mt-8 max-w-4xl overflow-hidden rounded-xl border border-cyan-400/15 bg-surface shadow-2xl shadow-cyan-500/5">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="ml-2 font-num text-[10px] text-zinc-500">
          {showLive
            ? "live strip · primary first"
            : showPreview
              ? "Preview · connect API for live strip"
              : "desk · loading catalog"}
        </span>
        {showLive && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live
          </span>
        )}
      </div>

      {busy && <SkeletonStrip />}

      {showPreview && <StaticPreview />}

      {showLive && (
        <div className="divide-y divide-line">
          {items.map((m) => {
            const { yes, no } = impliedSide(m);
            return (
              <Link
                key={m.marketId}
                href={`/markets/${encodeURIComponent(m.marketId)}`}
                className="group flex min-h-[44px] items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated active:scale-[0.995]"
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-[13px] font-medium group-hover:text-white ${
                      isUntitledMarket(m) ? "italic text-zinc-500" : "text-zinc-50"
                    }`}
                  >
                    {marketLabel(m)}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                    <PhaseBadge phase={m.phase} />
                    <span className="font-num">{formatVolumeUsdc(catalogVolume(m))}</span>
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right sm:w-28">
                  <ProbBar yes={yes} no={no} size="sm" showLabels />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
