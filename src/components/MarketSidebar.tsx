"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCatalog, useHydratedDetails, useViewportIds } from "@/lib/data/hooks";
import { mergeMarket } from "@/lib/panta/markets";
import type { Market } from "@/lib/panta/domain";
import { catalogVolume, hasSpotPrice, impliedSide, isUntitledMarket, marketActivityRank, marketLabel } from "@/lib/format";
import { SkeletonLoader } from "./ui/States";
import { MarketListRow } from "./desk/MarketListRow";
import { IconSearch } from "./ui/Icons";

function pct(p: string | null) {
  return hasSpotPrice(p) ? `${Math.round(Number(p) * 100)}%` : "—";
}

/**
 * Compact market switcher for the market workspace (left column, xl+).
 * Same shared catalog cache and viewport-gated hydration as the desk list.
 */
export function MarketSidebar({ activeId }: { activeId: string }) {
  const catalog = useCatalog({});
  const [q, setQ] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const { visible, track } = useViewportIds("200px 0px");
  const details = useHydratedDetails(catalog.items, visible);

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const merged: Market[] = catalog.items.map((m) => mergeMarket(m, details.get(m.marketId)));
    return merged
      .filter((m) => (openOnly ? marketActivityRank(m) <= 1 : true))
      .filter((m) => !qq || marketLabel(m).toLowerCase().includes(qq) || (m.category || "").toLowerCase().includes(qq))
      .sort((a, b) => {
        // Titled first, then priced, then by volume — the same honesty as the desk default.
        const t = Number(isUntitledMarket(a)) - Number(isUntitledMarket(b));
        if (t) return t;
        const p = Number(!hasSpotPrice(impliedSide(a).yes)) - Number(!hasSpotPrice(impliedSide(b).yes));
        if (p) return p;
        return (catalogVolume(b) ?? 0) - (catalogVolume(a) ?? 0);
      })
      .slice(0, 40);
  }, [catalog.items, details, q, openOnly]);

  return (
    <nav aria-label="Markets" className="card flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
      <div className="border-b border-line p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-ink">Markets</h2>
          <Link href="/desk" className="text-[12px] text-cyan-300 hover:text-cyan-200">
            All markets
          </Link>
        </div>
        <label className="relative mt-2 block">
          <span className="sr-only">Search markets</span>
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets…" className="field !min-h-9 pl-8 text-[13px]" />
        </label>
        <div className="mt-2 flex gap-1.5">
          <button type="button" className="chip" aria-pressed={openOnly} onClick={() => setOpenOnly(true)}>
            Open
          </button>
          <button type="button" className="chip" aria-pressed={!openOnly} onClick={() => setOpenOnly(false)}>
            All phases
          </button>
        </div>
      </div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-2">
        {catalog.isPending ? (
          <SkeletonLoader rows={6} label="Loading markets" />
        ) : catalog.isError ? (
          <div className="p-3 text-[12px] text-rose-200">
            Couldn&apos;t load markets.{" "}
            <button type="button" className="underline" onClick={() => catalog.refetch()}>
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-3 text-[12px] text-ink-3">No markets match.</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((m) => {
              const { yes, no } = impliedSide(m);
              return (
                <li key={m.marketId} ref={track(m.marketId)}>
                  <MarketListRow
                    href={`/markets/${m.marketId}`}
                    active={m.marketId === activeId}
                    title={marketLabel(m)}
                    untitled={isUntitledMarket(m)}
                    yesLabel={pct(yes)}
                    noLabel={pct(no)}
                    phase={m.phase}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
