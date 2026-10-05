"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useNow } from "@/hooks/useNow";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Market, TapePage } from "@/lib/panta/domain";
import {
  buildSecondarySnapshot,
  formatAgeMinutes,
  formatSecondaryPrice,
  flowDirectionLabel,
  ORDER_BOOK_DEPTH_UNAVAILABLE,
  pantaMarketUrl,
  secondaryTapeQuality,
  SECONDARY_EXEC_LINE,
  SECONDARY_PHASE_LINE,
} from "@/lib/panta/secondary-intel";
import { marketLifecycle, LIFECYCLE_LABEL } from "@/lib/panta/catalog";
import { Panel } from "./Panel";
import { StatusBadge } from "./ui/StatusBadge";

type TradesQ = UseQueryResult<TapePage, Error>;

function freshnessLabel(opts: { updatedAt: number | null; isFetching: boolean; isError: boolean; hasData: boolean; nowMs: number }): string {
  if (opts.isError && !opts.hasData) return "Refresh failed";
  if (opts.isFetching) return "Refreshing";
  if (!opts.updatedAt) return "—";
  const age = Math.max(0, Math.floor((opts.nowMs - opts.updatedAt) / 1000));
  if (age < 5) return "Updated just now";
  return `Updated ${age}s ago`;
}

/**
 * Read-only Secondary Market Intelligence desk panel.
 * Never implies Brief Command routes secondary CLOB execution.
 */
export function SecondaryIntelligence({
  market,
  trades,
  marketUpdatedAt = null,
  marketFetching = false,
  marketError = false,
}: {
  market: Market;
  trades: TradesQ;
  marketUpdatedAt?: number | null;
  marketFetching?: boolean;
  marketError?: boolean;
}) {
  const nowMs = useNow(30_000);
  const tape = trades.data?.trades ?? [];
  const hasTapeData = trades.data !== undefined;
  const quality = secondaryTapeQuality({
    isError: Boolean(trades.isError),
    isPending: trades.isPending,
    hasData: hasTapeData,
    completeness: trades.data?.completeness ?? null,
    secondaryPrintCount: tape.filter((t) => t.isPrimary === false).length,
  });

  const snap = useMemo(
    () => buildSecondarySnapshot(market, tape, nowMs, quality),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [market, tape, quality.kind, trades.dataUpdatedAt],
  );

  const lc = marketLifecycle(market);
  const fresh = freshnessLabel({
    updatedAt: marketUpdatedAt,
    isFetching: marketFetching,
    isError: marketError,
    hasData: true,
    nowMs,
  });
  const pantaUrl = pantaMarketUrl(market.marketId);
  const flowDir = flowDirectionLabel(snap.flow);

  return (
    <Panel
      title="Secondary Market Intelligence"
      action={
        <a
          href={pantaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary btn-sm mr-2"
        >
          Trade on Panta ↗
        </a>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="info" size="xs">
            SECONDARY
          </StatusBadge>
          <span className="text-[11px] text-ink-3">{LIFECYCLE_LABEL[lc]}</span>
          <span className="text-[11px] text-ink-3">· {fresh}</span>
        </div>

        <p className="text-[12px] leading-relaxed text-ink-2">{SECONDARY_PHASE_LINE}</p>
        <p className="text-[11px] leading-relaxed text-ink-3">{SECONDARY_EXEC_LINE}</p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Resolution" value={snap.resolutionLabel} />
          <Stat label="Activity score" value={String(snap.activityScore)} sub="Radar · not edge" />
          <Stat label="Secondary prints" value={String(snap.flow.printCount)} />
          <Stat
            label="Traded shares"
            value={snap.flow.tradedShares != null ? snap.flow.tradedShares.toFixed(2) : "—"}
            sub={
              snap.flow.tradedShares != null
                ? undefined
                : snap.flow.printCount === 0
                  ? "No secondary prints"
                  : "Incomplete sizes"
            }
          />
        </div>

        <div className="rounded-xl border border-line bg-inset/60 px-3 py-2.5">
          <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">{snap.prices.label}</p>
          <div className="mt-2 flex flex-wrap gap-4 font-num text-[15px]">
            <span className="text-emerald-300" title={snap.prices.yesLabel}>
              YES <span className="text-ink">{formatSecondaryPrice(snap.prices.yes)}</span>
            </span>
            <span className="text-rose-300" title={snap.prices.noLabel}>
              NO <span className="text-ink">{formatSecondaryPrice(snap.prices.no)}</span>
            </span>
          </div>
          <p className="mt-1 font-num text-[11px] text-ink-3">
            {snap.prices.yesLabel}: {formatSecondaryPrice(snap.prices.yes)} · {snap.prices.noLabel}:{" "}
            {formatSecondaryPrice(snap.prices.no)}
          </p>
          <p className="mt-1.5 text-[11px] text-ink-3">
            Independent per-side last observations — not probabilities, not complementary, not bid/ask/mid/spread.
            Observation time: {snap.prices.observedAtLabel}.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-inset/60 px-3 py-2.5">
            <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">Secondary flow</p>
            <p className="mt-1.5 text-[13px] font-medium text-ink">{flowDir}</p>
            <p className="font-num mt-1 text-[11px] text-ink-3">
              {snap.flow.yesPrints} YES · {snap.flow.noPrints} NO prints
              {snap.flow.basis ? ` · ${snap.flow.basis}-weighted` : ""}
              {snap.flow.uniqueWallets > 0 ? ` · ${snap.flow.uniqueWallets} wallets` : ""}
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              Latest print {formatAgeMinutes(snap.flow.latestPrintAgeMinutes)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-inset/60 px-3 py-2.5">
            <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">Tape quality</p>
            {quality.kind === "loading" ? (
              <p className="mt-1.5 text-[12px] text-ink-3">Loading secondary tape…</p>
            ) : quality.kind === "failed" ? (
              <p role="alert" className="mt-1.5 text-[12px] text-amber-200">
                {quality.label}
                <button type="button" className="ml-2 underline" onClick={() => void trades.refetch()}>
                  Retry
                </button>
              </p>
            ) : quality.kind === "partial" ? (
              <p className="mt-1.5 text-[12px] text-amber-100/90">
                Partial sample · returned {quality.returned} · parsed {quality.parsed} · dropped{" "}
                {quality.dropped}
              </p>
            ) : quality.kind === "empty" ? (
              <p className="mt-1.5 text-[12px] text-ink-3">No observed secondary prints — secondary flow unavailable.</p>
            ) : (
              <p className="mt-1.5 text-[12px] text-ink-2">Complete readable sample</p>
            )}
          </div>
        </div>

        <p className="rounded-lg border border-line bg-inset/40 px-3 py-2 text-[11px] leading-relaxed text-ink-3">
          {ORDER_BOOK_DEPTH_UNAVAILABLE}
        </p>

        <p className="text-[11px] text-ink-3">
          Navigation only —{" "}
          <a href={pantaUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
            open this market on Panta
          </a>
          . Secondary CLOB trading is not routed through Brief Command.{" "}
          <Link href="/book" className="text-cyan-300 hover:underline">
            Book
          </Link>{" "}
          remains for claims on resolved holdings.
        </p>
      </div>
    </Panel>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-inset/60 px-3 py-2">
      <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">{label}</p>
      <p className="font-num mt-1 truncate text-[15px] font-semibold text-ink">{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-ink-3">{sub}</p> : null}
    </div>
  );
}
