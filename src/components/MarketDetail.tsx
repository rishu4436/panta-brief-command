"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMarket, useMarketTrades } from "@/lib/data/hooks";
import { describeErr } from "@/lib/errors";
import {
  catalogVolume,
  formatVolumeUsdc,
  impliedSide,
  isUntitledMarket,
  marketLabel,
  shortAddr,
  shouldShowCategoryChip,
} from "@/lib/format";
import { notifyStorage, pushRecent } from "@/lib/storage";
import { AiBrief } from "./AiBrief";
import { Panel } from "./Panel";
import { PhaseBadge } from "./PhaseBadge";
import { DualSideHero } from "./ProbBar";
import { PrimaryBuyPanel } from "./PrimaryBuyPanel";
import { TapeSparkline } from "./TapeSparkline";
import { TradeTape } from "./TradeTape";
import { MarketSidebar } from "./MarketSidebar";
import { ErrorState } from "./ui/States";
import { WatchStar } from "./WatchStar";

function formatEnd(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatUpdated(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[260px_minmax(0,1fr)_400px]">
      <div className="hidden xl:block">
        <div className="skeleton h-[520px] w-full rounded-2xl" />
      </div>
      <div className="space-y-4">
        <div className="skeleton h-5 w-24" />
        <div className="skeleton h-8 w-3/4" />
        <div className="skeleton h-40 w-full rounded-2xl" />
        <div className="skeleton h-64 w-full rounded-2xl" />
      </div>
      <div className="space-y-4">
        <div className="skeleton h-[360px] w-full rounded-2xl" />
        <div className="skeleton h-[300px] w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function MarketDetail({ marketId }: { marketId: string }) {
  const id = marketId.trim();
  const detail = useMarket(id);
  const trades = useMarketTrades(id);
  const [descOpen, setDescOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Shared cache: placeholder is the catalog row until the detail lands.
  const market = detail.data ?? null;
  const busy = detail.isPending;
  const error = detail.error ? describeErr(detail.error) : !id ? "Missing marketId" : null;
  const updatedAt = detail.isPlaceholderData ? null : detail.dataUpdatedAt || null;
  const tape = trades.data ?? [];
  const tapeBusy = trades.isPending;
  const load = () => void detail.refetch();

  // Record the visit (localStorage only; no React state involved).
  useEffect(() => {
    if (!id || !detail.isSuccess || detail.isPlaceholderData) return;
    pushRecent(id);
    notifyStorage();
  }, [id, detail.isSuccess, detail.isPlaceholderData]);

  if (busy && !market) {
    return (
      <div className="animate-fade-in" role="status" aria-label="Loading market">
        <DetailSkeleton />
      </div>
    );
  }

  if (error && !market) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <ErrorState
          title="Couldn't load this market"
          description={
            <>
              {error}. Check the link or try again.
              <span className="mt-1 block break-all font-addr text-[11px] opacity-70">marketId: {marketId}</span>
            </>
          }
          onRetry={load}
        />
        <Link href="/desk" className="btn btn-ghost mt-3">
          ← Back to markets
        </Link>
      </div>
    );
  }

  if (!market) return null;

  const { yes, no } = impliedSide(market);
  const heading = marketLabel(market);
  const desc = (market.description || market.resolutionRule || "").trim();
  const descIsDupe =
    desc &&
    heading &&
    desc.slice(0, 80).toLowerCase() === heading.slice(0, 80).toLowerCase();
  const showDesc = desc && !descIsDupe;

  const vol = formatVolumeUsdc(catalogVolume(market));

  return (
    <div className="grid gap-4 animate-fade-in lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_auto_1fr] xl:grid-cols-[256px_minmax(0,1fr)_392px] 2xl:grid-cols-[280px_minmax(0,1fr)_420px]">
      {/* DOM order = mobile order: detail → brief → trade → activity. Grid placement builds the desktop workspace. */}
      <aside className="hidden self-start xl:sticky xl:top-20 xl:col-start-1 xl:row-span-3 xl:row-start-1 xl:block">
        <MarketSidebar activeId={market.marketId} />
      </aside>

      {/* Centre: selected market */}
      <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1 xl:col-start-2">
        <header>
          <Link href="/desk" className="type-back inline-flex min-h-8 items-center transition">
            ← Markets
          </Link>
          <div className="mt-1 flex items-start gap-2">
            <h1 className={`type-display min-w-0 flex-1 break-words ${isUntitledMarket(market) ? "market-title--untitled" : ""}`}>
              {heading}
            </h1>
            <WatchStar marketId={market.marketId} />
            <button
              type="button"
              onClick={async () => {
                try {
                  const url = typeof window !== "undefined" ? window.location.href : "";
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* ignore */
                }
              }}
              className="btn btn-secondary btn-sm shrink-0"
              aria-label="Copy link to market"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PhaseBadge phase={market.phase} />
            {shouldShowCategoryChip(market.category, market.title, market.description) ? (
              <span className="rounded-md border border-line px-2 py-0.5 text-[11px] capitalize text-ink-3">{market.category}</span>
            ) : null}
            <span className="type-meta flex flex-wrap items-center gap-x-2 font-num">
              <span title={market.marketId}>{shortAddr(market.marketId, 5)}</span>
              {updatedAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Updated {formatUpdated(updatedAt)} IST</span>
                </>
              ) : null}
            </span>
          </div>
        </header>

        <Panel title="Probability" subtitle="Live spot · blank means not priced yet">
          <DualSideHero yes={yes} no={no} />
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[12px] sm:grid-cols-4">
            <div>
              <dt className="text-ink-3">Volume</dt>
              <dd className="font-num mt-0.5 text-[14px] font-medium text-ink">{vol}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Ends</dt>
              <dd className="font-num mt-0.5 text-[14px] font-medium text-ink">{market.endTime ? `${formatEnd(market.endTime)} IST` : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Resolves</dt>
              <dd className="font-num mt-0.5 text-[14px] font-medium text-ink">
                {market.resolutionTime ? `${formatEnd(market.resolutionTime)} IST` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Prints in window</dt>
              <dd className="font-num mt-0.5 text-[14px] font-medium text-ink">{tapeBusy ? "…" : tape.length}</dd>
            </div>
          </dl>
        </Panel>

        <TapeSparkline items={tape} busy={tapeBusy} size="lg" />
      </div>

      {/* Right: AI brief */}
      <div className="min-w-0 self-start lg:col-start-2 lg:row-span-3 lg:row-start-1 xl:col-start-3">
        <AiBrief market={market} auto />
      </div>

      {/* Centre: trade ticket */}
      <div className="min-w-0 self-start lg:col-start-1 lg:row-start-2 xl:col-start-2">
        <PrimaryBuyPanel initialMarketId={market.marketId} compact market={market} />
      </div>

      {/* Centre: activity + context */}
      <div className="min-w-0 space-y-4 self-start lg:col-start-1 lg:row-start-3 xl:col-start-2">
        <TradeTape items={tape} busy={tapeBusy} />

        <Panel title="Context">
          {showDesc ? (
            <div>
              <p className={`type-body ${descOpen ? "" : "line-clamp-4"}`}>{desc}</p>
              {desc.length > 180 && (
                <button type="button" onClick={() => setDescOpen((v) => !v)} className="mt-1 min-h-8 text-[12px] text-cyan-300 hover:underline">
                  {descOpen ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          ) : (
            <p className="type-body text-ink-3">
              {descIsDupe ? "See the headline above for the market question." : "No additional context on file."}
            </p>
          )}
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 border-t border-line pt-3 text-[12px] sm:grid-cols-2">
            {(
              [
                ["Region", market.region || "—"],
                ["Type", market.marketType || "—"],
                ["Creator", shortAddr(market.creatorAddress, 4)],
                ["Oracle", market.oracle || "—"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-ink-3">{k}</dt>
                <dd className="max-w-[65%] truncate text-right text-ink-2" title={v}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
