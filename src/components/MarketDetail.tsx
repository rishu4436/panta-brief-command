"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import {
  formatOddsPct,
  formatPrice,
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
import { GlassCard } from "./GlassCard";
import { PhaseBadge } from "./PhaseBadge";
import { PrimaryBuyPanel } from "./PrimaryBuyPanel";
import { TradeTape } from "./TradeTape";

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
      <GlassCard>
        <p className="text-sm text-zinc-400">Loading market detail…</p>
      </GlassCard>
    );
  }

  if (error && !market) {
    return (
      <GlassCard>
        <p className="text-sm text-rose-300">{error}</p>
        <Link href="/" className="mt-3 inline-block text-sm text-cyan-300">
          ← Back to catalog
        </Link>
      </GlassCard>
    );
  }

  if (!market) return null;

  const { yes, no } = impliedSide(market);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/"
            className="text-[11px] uppercase tracking-wide text-cyan-400/80 hover:text-cyan-300"
          >
            ← Intel catalog
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
            {market.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <PhaseBadge phase={market.phase} />
            <span>{market.category}</span>
            <span>·</span>
            <span>{shortAddr(market.marketId, 6)}</span>
            <span>·</span>
            <span>{formatVolumeUsdc(market.volumeUsdc)}</span>
          </div>
        </div>
        <Link
          href={`/execute?marketId=${encodeURIComponent(market.marketId)}`}
          className="rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20"
        >
          Execute buy →
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard title="Live odds (detail)" className="lg:col-span-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4">
              <div className="text-[11px] uppercase text-emerald-300/80">YES</div>
              <div className="mt-1 text-2xl font-bold text-emerald-200">
                {formatOddsPct(yes)}
              </div>
              <div className="text-xs text-emerald-200/60">{formatPrice(yes)}</div>
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4">
              <div className="text-[11px] uppercase text-rose-300/80">NO</div>
              <div className="mt-1 text-2xl font-bold text-rose-200">
                {formatOddsPct(no)}
              </div>
              <div className="text-xs text-rose-200/60">{formatPrice(no)}</div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">
            List endpoints return null prices — detail fills spot when RPC is
            available.
          </p>
          {market.description && (
            <p className="mt-3 line-clamp-6 text-sm text-zinc-300">
              {market.description}
            </p>
          )}
        </GlassCard>

        <div className="space-y-4 lg:col-span-2">
          <AiBrief market={market} tape={tape} />
          <TradeTape items={tape} busy={tapeBusy} />
        </div>
      </div>

      <PrimaryBuyPanel initialMarketId={market.marketId} />
    </div>
  );
}
