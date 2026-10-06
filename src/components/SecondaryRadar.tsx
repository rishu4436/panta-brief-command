"use client";

import { useMemo } from "react";
import { useNow } from "@/hooks/useNow";
import Link from "next/link";
import { useMarketDetails, useTradesFor } from "@/lib/data/hooks";
import { mergeMarket } from "@/lib/panta/markets";
import type { Market } from "@/lib/panta/domain";
import {
  buildSecondarySnapshot,
  formatAgeMinutes,
  formatSecondaryPrice,
  flowDirectionLabel,
  ORDER_BOOK_DEPTH_UNAVAILABLE,
  pickSecondaryRadarCandidates,
  secondaryTapeQuality,
  sortRadarRows,
  type RadarRow,
} from "@/lib/panta/secondary-intel";
import { Panel } from "./Panel";
import { marketHref } from "@/lib/panta/lifecycle";

const MAX_CANDIDATES = 6;
const MAX_ROWS = 5;

/**
 * Compact Secondary Radar on /desk.
 * Stacked list items (no horizontal table) so the narrow right rail at
 * 1440/1280/mobile never clips YES/NO or meta columns.
 * Hydrates detail for radar candidates (shared limiter) so chain-only catalog
 * rows get secondary* last-obs prices. Bounded tape hydration via shared cache.
 */
export function SecondaryRadar({ markets, catalogLoading = false }: { markets: Market[]; catalogLoading?: boolean }) {
  const candidates = useMemo(() => pickSecondaryRadarCandidates(markets, MAX_CANDIDATES), [markets]);
  // Always hydrate candidate details (not needsDetail-gated): chain-only rows
  // often lack secondary* until /markets/{id}/ lands.
  const details = useMarketDetails(candidates.map((m) => m.marketId), MAX_CANDIDATES);
  const hydrated = useMemo(
    () => candidates.map((m) => mergeMarket(m, details.get(m.marketId))),
    [candidates, details],
  );
  const queries = useTradesFor(hydrated.map((m) => m.marketId));
  const nowMs = useNow(30_000);

  const tapeKey = queries.map((q) => `${q.fetchStatus}:${q.status}:${q.dataUpdatedAt}:${q.isError}`).join("|");
  const detailKey = hydrated.map((m) => `${m.marketId}:${m.secondaryYesPrice ?? ""}:${m.secondaryNoPrice ?? ""}`).join("|");
  const rows: RadarRow[] = useMemo(() => {
    const out: RadarRow[] = [];
    hydrated.forEach((m, i) => {
      const q = queries[i];
      const tape = q?.data?.trades ?? [];
      const quality = secondaryTapeQuality({
        isError: Boolean(q?.isError),
        isPending: Boolean(q?.isPending),
        hasData: q?.data !== undefined,
        completeness: q?.data?.completeness ?? null,
        secondaryPrintCount: tape.filter((t) => t.isPrimary === false).length,
      });
      const snap = buildSecondarySnapshot(m, quality.kind === "failed" && !q?.data ? [] : tape, nowMs, quality);
      out.push({ ...snap, flowDirection: flowDirectionLabel(snap.flow) });
    });
    return sortRadarRows(out).slice(0, MAX_ROWS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tapeKey, detailKey, nowMs]);

  const loading = candidates.length > 0 && queries.some((q) => q.isPending && !q.data);
  const anyFailed = queries.some((q) => q.isError && !q.data);

  if (catalogLoading && candidates.length === 0) {
    return (
      <Panel title="Secondary radar">
        <p className="text-[12px] text-ink-3">Loading secondary candidates…</p>
        <p className="mt-2 text-[11px] text-ink-3">{ORDER_BOOK_DEPTH_UNAVAILABLE}</p>
      </Panel>
    );
  }

  if (candidates.length === 0) {
    return (
      <Panel title="Secondary radar">
        <p className="text-[12px] text-ink-3">No secondary-phase markets in the current catalog slice.</p>
        <p className="mt-2 text-[11px] text-ink-3">{ORDER_BOOK_DEPTH_UNAVAILABLE}</p>
      </Panel>
    );
  }

  return (
    <Panel title="Secondary radar" flush>
      <div className="border-b border-line px-3.5 py-2 text-[11px] text-ink-3">
        Strongest observable secondary markets (read-only). Activity score ranks recent secondary prints,
        share volume, print recency, wallets and resolution proximity — not edge or expected return.
        {loading ? " · Loading tapes…" : null}
        {anyFailed ? " · Some tape requests failed (shown below; not treated as quiet)." : null}
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.marketId} className="relative px-3.5 py-2.5 hover:bg-elevated/50">
            <span
              className="font-num absolute right-3 top-2.5 rounded-md border border-line bg-inset px-1.5 py-0.5 text-[10px] text-ink-2"
              title="Activity score (not edge)"
            >
              {r.activityScore.toFixed(1)}
            </span>
            <Link
              href={marketHref(r.marketId)}
              className="block pr-12 text-[12px] font-medium leading-snug text-ink hover:text-cyan-200"
              title={r.title}
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {r.title}
            </Link>
            {r.tapeQuality.kind === "failed" ? (
              <span className="mt-0.5 block text-[10px] text-amber-200">Tape failed</span>
            ) : r.tapeQuality.kind === "partial" ? (
              <span className="mt-0.5 block text-[10px] text-amber-200/90">Partial sample</span>
            ) : null}
            <p className="font-num mt-1 text-[11px] text-ink-2">
              <span className="text-emerald-300">YES</span> {formatSecondaryPrice(r.prices.yes)}
              <span className="text-ink-3"> · </span>
              <span className="text-rose-300">NO</span> {formatSecondaryPrice(r.prices.no)}
              <span className="text-ink-3"> last observed</span>
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] text-ink-3">
              <span className="font-num">{r.flow.printCount} prints</span>
              <span aria-hidden="true">·</span>
              <span className="font-num">
                {r.flow.tradedShares != null ? `${r.flow.tradedShares.toFixed(1)} sh` : "— sh"}
              </span>
              <span aria-hidden="true">·</span>
              <span>{r.flowDirection}</span>
              <span aria-hidden="true">·</span>
              <span>{formatAgeMinutes(r.flow.latestPrintAgeMinutes)}</span>
              <span aria-hidden="true">·</span>
              <span>{r.resolutionLabel}</span>
            </p>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-3.5 py-2 text-[11px] text-ink-3">{ORDER_BOOK_DEPTH_UNAVAILABLE}</p>
    </Panel>
  );
}
