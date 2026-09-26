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
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-3">
        <div className="skeleton h-40 w-full rounded-lg" />
        <div className="skeleton h-56 w-full rounded-lg" />
      </div>
      <div className="space-y-3 lg:col-span-5">
        <div className="skeleton h-36 w-full rounded-lg" />
        <div className="skeleton h-72 w-full rounded-lg" />
      </div>
      <div className="lg:col-span-4">
        <div className="skeleton h-[420px] w-full rounded-lg" />
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
      <div className="space-y-3 animate-fade-in">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-7 w-2/3 max-w-xl" />
        <DetailSkeleton />
      </div>
    );
  }

  if (error && !market) {
    return (
      <Panel>
        <p className="text-sm text-rose-300">{error}</p>
        <p className="mt-2 font-num text-[11px] text-zinc-500 break-all">
          marketId: {marketId}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={load}
            className="text-sm text-cyan-400 hover:text-cyan-300"
          >
            Retry
          </button>
          <Link
            href="/desk"
            className="text-sm text-cyan-400 hover:text-cyan-300"
          >
            ← Back to desk
          </Link>
        </div>
      </Panel>
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

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <Link href="/desk" className="type-back transition">
          ← Desk
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h1
                className={`type-display min-w-0 flex-1 break-words ${
                  isUntitledMarket(market) ? "market-title--untitled" : ""
                }`}
              >
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
                className="min-h-[32px] shrink-0 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] text-zinc-400 transition hover:border-cyan-400/30 hover:text-cyan-300 active:scale-[0.98]"
                aria-label="Copy link to market"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            {/* Primary meta: phase + ends + volume — keep calm */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <PhaseBadge phase={market.phase} />
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-400/[0.07] px-2 py-0.5 font-num text-[11px] tabular-nums text-amber-200/90">
                <span className="text-[10px] font-medium text-amber-400/70">Ends</span>
                {formatEnd(market.endTime)} IST
              </span>
              {shouldShowCategoryChip(market.category, market.title, market.description) ? (
                <span className="cat-chip rounded border border-line px-1.5 py-0.5 text-[10px] capitalize text-zinc-500">
                  {market.category}
                </span>
              ) : null}
              <span className="font-num text-[12px] tabular-nums text-zinc-400">
                {formatVolumeUsdc(catalogVolume(market))}
              </span>
            </div>
            {/* Secondary meta: hashes / oracle / resolution — quieter line */}
            <div className="type-meta mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-num">
              <span title={market.marketId}>{shortAddr(market.marketId, 5)}</span>
              {market.oracle ? (
                <>
                  <span className="text-zinc-700">·</span>
                  <span title={market.oracle} className="max-w-[140px] truncate">
                    Oracle {shortAddr(market.oracle, 4)}
                  </span>
                </>
              ) : null}
              {market.resolutionTime ? (
                <>
                  <span className="text-zinc-700">·</span>
                  <span>Resolves {formatEnd(market.resolutionTime)} IST</span>
                </>
              ) : null}
              {updatedAt ? (
                <>
                  <span className="text-zinc-700">·</span>
                  <span>Updated {formatUpdated(updatedAt)} IST</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-12 lg:items-start">
        <div className="space-y-3 lg:col-span-3">
          <Panel title="Context">
            {showDesc ? (
              <div>
                <p
                  className={`type-body ${
                    descOpen ? "" : "line-clamp-4"
                  }`}
                >
                  {desc}
                </p>
                {desc.length > 180 && (
                  <button
                    type="button"
                    onClick={() => setDescOpen((v) => !v)}
                    className="mt-1 text-[11px] text-cyan-400 hover:underline"
                  >
                    {descOpen ? "Less" : "More"}
                  </button>
                )}
              </div>
            ) : (
              <p className="type-body text-zinc-600">
                {descIsDupe
                  ? "See headline above for the market question."
                  : "No additional context on file."}
              </p>
            )}
            <dl className="type-meta mt-3 space-y-1.5 border-t border-line pt-3">
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-600">Region</dt>
                <dd className="text-zinc-400">{market.region || "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-600">Type</dt>
                <dd className="text-zinc-400">{market.marketType || "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-600">Creator</dt>
                <dd className="font-num text-zinc-400">
                  {shortAddr(market.creatorAddress, 4)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-600">Resolution</dt>
                <dd className="text-right text-zinc-400">
                  {formatEnd(market.resolutionTime)} IST
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-600">Oracle</dt>
                <dd
                  className="max-w-[60%] truncate text-right text-zinc-400"
                  title={market.oracle || undefined}
                >
                  {market.oracle || "—"}
                </dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Probability">
            <DualSideHero yes={yes} no={no} />
            <p className="type-meta mt-3">Live spot · blank means not priced yet</p>
          </Panel>
          <TapeSparkline items={tape} busy={tapeBusy} />
        </div>

        <div className="space-y-3 lg:col-span-5">
          <AiBrief market={market} auto />
          <TradeTape items={tape} busy={tapeBusy} />
        </div>

        <div className="lg:col-span-4 lg:sticky lg:top-16">
          <PrimaryBuyPanel initialMarketId={market.marketId} compact />
        </div>
      </div>
    </div>
  );
}
