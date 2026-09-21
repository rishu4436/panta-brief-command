"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import {
  formatVolumeUsdc,
  impliedSide,
  shortAddr,
} from "@/lib/format";
import type {
  CatalogTradeRow,
  MarketCatalogItem,
  MarketTradesResponse,
} from "@/lib/types";
import { AiBrief } from "./AiBrief";
import { Panel } from "./Panel";
import { PhaseBadge } from "./PhaseBadge";
import { DualSideHero } from "./ProbBar";
import { PrimaryBuyPanel } from "./PrimaryBuyPanel";
import { TradeTape } from "./TradeTape";

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

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await pantaFetch<MarketCatalogItem>(
        `/markets/${encodeURIComponent(marketId)}/`,
      );
      setMarket(data);
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  }, [marketId]);

  const loadTape = useCallback(async () => {
    setTapeBusy(true);
    try {
      const { data } = await pantaFetch<MarketTradesResponse>(
        `/markets/${encodeURIComponent(marketId)}/trades/`,
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
        <Link
          href="/desk"
          className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300"
        >
          ← Back to desk
        </Link>
      </Panel>
    );
  }

  if (!market) return null;

  const { yes, no } = impliedSide(market);

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <Link
          href="/desk"
          className="text-[11px] uppercase tracking-wide text-zinc-600 transition hover:text-cyan-400"
        >
          ← Desk
        </Link>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50 md:text-2xl">
              {market.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              <PhaseBadge phase={market.phase} />
              <span className="rounded border border-[#1f1f23] px-1.5 py-0.5">
                {market.category || "—"}
              </span>
              <span className="font-num">{shortAddr(market.marketId, 6)}</span>
              <span>·</span>
              <span className="font-num">{formatVolumeUsdc(market.volumeUsdc)}</span>
              <span>·</span>
              <span>Ends {formatEnd(market.endTime)} IST</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3-column terminal */}
      <div className="grid gap-3 lg:grid-cols-12 lg:items-start">
        {/* Left — context + AI brief */}
        <div className="space-y-3 lg:col-span-3">
          <Panel title="Context">
            {market.description ? (
              <p className="text-[13px] leading-relaxed text-zinc-400">
                {market.description}
              </p>
            ) : (
              <p className="text-[13px] text-zinc-600">No description on file.</p>
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
            </dl>
          </Panel>
          <AiBrief market={market} tape={tape} />
        </div>

        {/* Center — probability hero + tape */}
        <div className="space-y-3 lg:col-span-5">
          <Panel title="Probability">
            <DualSideHero yes={yes} no={no} />
            <p className="mt-3 text-[10px] text-zinc-600">
              Spot from detail when RPC fills · list rows may show null until open
            </p>
          </Panel>
          <TradeTape items={tape} busy={tapeBusy} />
        </div>

        {/* Right — sticky execute ticket */}
        <div className="lg:col-span-4 lg:sticky lg:top-16">
          <PrimaryBuyPanel initialMarketId={market.marketId} compact />
        </div>
      </div>
    </div>
  );
}
