"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { pantaFetch } from "@/lib/api";
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
import type {
  CatalogTradeRow,
  MarketCatalogItem,
  MarketTradesResponse,
} from "@/lib/types";
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
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
  const [market, setMarket] = useState<MarketCatalogItem | null>(null);
  const [tape, setTape] = useState<CatalogTradeRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [tapeBusy, setTapeBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const id = marketId.trim();
      if (!id) throw new Error("Missing marketId");
      const { data } = await pantaFetch<MarketCatalogItem>(
        `/markets/${encodeURIComponent(id)}/`,
      );
      setMarket(data);
      setUpdatedAt(Date.now());
      pushRecent(id);
      notifyStorage();
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  }, [marketId]);

  const loadTape = useCallback(async () => {
    setTapeBusy(true);
    try {
      const id = marketId.trim();
      const { data } = await pantaFetch<MarketTradesResponse>(
        `/markets/${encodeURIComponent(id)}/trades/`,
      );
      setTape(data.items || []);
    } catch {
      setTape([]);
    } finally {
      setTapeBusy(false);
    }
  }, [marketId]);

  useEffect(() => {
    void load();
    void loadTape();
  }, [load, loadTape]);

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
            onClick={() => void load()}
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
  const desc = (market.description || "").trim();
  const descIsDupe =
    desc &&
    heading &&
    desc.slice(0, 80).toLowerCase() === heading.slice(0, 80).toLowerCase();
  const showDesc = desc && !descIsDupe;

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <Link
          href="/desk"
          className="text-[11px] uppercase tracking-wide text-zinc-500 transition hover:text-cyan-400"
        >
          ← Desk
        </Link>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h1
                className={`min-w-0 flex-1 break-words text-xl font-semibold leading-snug tracking-tight md:text-2xl ${
                  isUntitledMarket(market)
                    ? "italic text-zinc-500"
                    : "text-zinc-50"
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
                className="min-h-[36px] shrink-0 rounded-md border border-[#1f1f23] bg-[#111113] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-cyan-400/30 hover:text-cyan-300 active:scale-[0.98]"
                aria-label="Copy link to market"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              <PhaseBadge phase={market.phase} />
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1 font-num text-[11px] text-amber-200">
                <span className="text-[9px] uppercase tracking-wide text-amber-400/80">Ends</span>
                {formatEnd(market.endTime)} IST
              </span>
              {shouldShowCategoryChip(market.category, market.title, market.description) ? (
                <span className="rounded border border-[#1f1f23] px-1.5 py-0.5">
                  {market.category}
                </span>
              ) : null}
              <span className="font-num">{shortAddr(market.marketId, 6)}</span>
              <span>·</span>
              <span className="font-num">{formatVolumeUsdc(catalogVolume(market))}</span>
              {market.oracle ? (
                <>
                  <span>·</span>
                  <span title={market.oracle} className="max-w-[180px] truncate">
                    Oracle {market.oracle}
                  </span>
                </>
              ) : null}
              {market.resolutionTime ? (
                <>
                  <span>·</span>
                  <span>Resolution {formatEnd(market.resolutionTime)} IST</span>
                </>
              ) : null}
              {updatedAt ? (
                <>
                  <span>·</span>
                  <span className="font-num">Updated {formatUpdated(updatedAt)} IST</span>
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
                  className={`text-[13px] leading-relaxed text-zinc-300 ${
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
              <p className="text-[13px] text-zinc-600">
                {descIsDupe
                  ? "See headline above for the market question."
                  : "No additional context on file."}
              </p>
            )}
            <dl className="mt-4 space-y-2 border-t border-[#1f1f23] pt-3 text-[11px]">
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
          <AiBrief market={market} tape={tape} auto />
        </div>

        <div className="space-y-3 lg:col-span-5">
          <Panel title="Probability">
            <DualSideHero yes={yes} no={no} />
            <p className="mt-3 text-[10px] text-zinc-600">
              Live spot · blank means not priced yet
            </p>
          </Panel>
          <TapeSparkline items={tape} busy={tapeBusy} spotYes={yes != null && yes !== "" ? Number(yes) : null} />
          <TradeTape items={tape} busy={tapeBusy} />
        </div>

        <div className="lg:col-span-4 lg:sticky lg:top-16">
          <PrimaryBuyPanel initialMarketId={market.marketId} compact />
        </div>
      </div>
    </div>
  );
}
