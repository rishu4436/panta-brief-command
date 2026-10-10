"use client";

/**
 * The room's market, read live through the existing data layer (catalog +
 * Panta detail merge, Stage D marketState). The room stores only the id, so
 * everything here is Panta's current record; unavailable data says so.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useMarket, useMarketTrades } from "@/lib/data/hooks";
import { useCreateEvidence } from "@/lib/data/created";
import { useQuoteUnavailable } from "@/lib/data/reconcile";
import { useNow } from "@/hooks/useNow";
import { catalogVolume, formatFriendlyIst, formatUsdcPerShare, formatVolumeUsdc, marketLabel, shortAddr, shouldShowCategoryChip } from "@/lib/format";
import { isMarketNotFound, marketState } from "@/lib/panta/lifecycle";
import { rawPriceNote, marketProbability } from "@/lib/panta/prices";
import { computeMarketSignals } from "@/lib/panta/signals";
import { roomMarketCta, roomMarketPrice, roomMarketTiming } from "@/lib/rooms/market-context";
import { Panel } from "../Panel";
import { DualSideHero } from "../ProbBar";
import { MarketStateStrip } from "../market/MarketCommand";
import { ErrorState, Skeleton } from "../ui/States";
import { IconArrowRight } from "../ui/Icons";

export function RoomMarketPanel({ marketId }: { marketId: string }) {
  const detail = useMarket(marketId);
  const trades = useMarketTrades(marketId);
  const evidence = useCreateEvidence();
  const quoteUnavailable = useQuoteUnavailable(marketId);
  const market = detail.data ?? null;
  const state = marketState({
    marketId,
    market,
    loading: detail.isPending && !market,
    error: detail.error,
    notFound: isMarketNotFound(detail.error),
    quoteUnavailable,
    createdEvidence: evidence.created.find((r) => r.marketId === marketId) ?? null,
    registrationNeedsAttention: evidence.needsAttention.some((r) => r.expectedEventPda === marketId),
  });
  const price = roomMarketPrice(market, state);
  const timing = roomMarketTiming(market);
  const cta = roomMarketCta(marketId, state);

  const now = useNow(60_000);
  const risk = useMemo(() => {
    if (!market || !trades.data) return null;
    return computeMarketSignals(market, trades.data.trades, now, { tapeCompleteness: trades.data.completeness }).riskFlags;
  }, [market, trades.data, now]);

  if (state.kind === "loading") {
    return (
      <Panel title="Market" subtitle="Live from Panta">
        <div role="status" aria-label="Loading market" className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Panel>
    );
  }

  if (!market) {
    return (
      <Panel title="Market" subtitle="Live from Panta">
        <ErrorState
          title={state.label}
          description={
            <>
              {state.detail}
              <span className="mt-1 block break-all font-addr text-[11px] opacity-70">marketId: {marketId}</span>
            </>
          }
          onRetry={() => void detail.refetch()}
        />
        <Link href={cta.href} className="btn btn-secondary btn-sm mt-3">
          Open market page
        </Link>
      </Panel>
    );
  }

  const heading = marketLabel(market);
  const vol = formatVolumeUsdc(catalogVolume(market));

  return (
    <Panel
      title="Market"
      subtitle="Live from Panta"
      action={
        <span className="hidden font-num text-[11px] text-ink-3 sm:inline" title={`The room stores only this market id: ${marketId}`}>
          {shortAddr(marketId, 5)}
        </span>
      }
    >
      <div className="space-y-4">
        <div>
          <Link href={cta.href} className="market-title market-title--link text-[17px] font-semibold leading-snug text-ink hover:text-cyan-200">
            {heading}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {market.category && shouldShowCategoryChip(market.category, market.title, market.description) ? (
              <span className="rounded-md border border-line px-2 py-0.5 text-[11px] capitalize text-ink-3">{market.category}</span>
            ) : null}
            {vol !== "—" ? <span className="type-meta font-num">Volume {vol}</span> : null}
          </div>
        </div>

        <MarketStateStrip state={state} market={market} />

        <section aria-label="Price">
          {price.kind === "probability" ? (
            <>
              <p className="mb-2 text-[12px] text-ink-3">{price.settled ? "Settlement prices after resolution · not a live probability" : "Implied probability from Panta's live YES/NO prices"}</p>
              <DualSideHero yes={price.yes} no={price.no} note={rawPriceNote(marketProbability(market))} />
            </>
          ) : price.kind === "secondary_last_observed" ? (
            <>
              <p className="mb-2 text-[12px] text-ink-3">Secondary phase: last observed price per side in USDC per share. Independent observations, not probabilities.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-3">
                  <p className="text-[11px] font-semibold tracking-wide text-emerald-300">YES · last observed</p>
                  <p className="font-num mt-1 text-[18px] font-semibold text-ink">{formatUsdcPerShare(price.yesUsdc)}</p>
                </div>
                <div className="rounded-xl border border-rose-400/25 bg-rose-400/[0.05] p-3">
                  <p className="text-[11px] font-semibold tracking-wide text-rose-300">NO · last observed</p>
                  <p className="font-num mt-1 text-[18px] font-semibold text-ink">{formatUsdcPerShare(price.noUsdc)}</p>
                </div>
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-100/90">{price.text}</p>
          )}
        </section>

        {timing.length ? (
          <dl className="grid gap-x-6 gap-y-1.5 border-t border-line pt-3 text-[12px] sm:grid-cols-2">
            {timing.map((t) => (
              <div key={t.label} className="flex justify-between gap-2">
                <dt className="text-ink-3">{t.label}</dt>
                <dd className="font-num text-right text-ink-2">{formatFriendlyIst(t.unix * 1000)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="border-t border-line pt-3 text-[12px] text-ink-3">Panta hasn&apos;t published timing for this market.</p>
        )}

        <section aria-label="Risk checks" className="border-t border-line pt-3">
          <h3 className="text-[12px] font-semibold text-ink-2">Risk checks</h3>
          {trades.isPending ? (
            <p className="mt-1 text-[12px] text-ink-3">Loading Panta&apos;s trade tape…</p>
          ) : trades.isError || !risk ? (
            <p className="mt-1 text-[12px] text-ink-3">Risk checks need Panta&apos;s trade tape, which didn&apos;t load. Open the market page for live data.</p>
          ) : risk.length ? (
            <ul className="mt-1.5 space-y-1">
              {risk.slice(0, 5).map((f) => (
                <li key={f.id} className={`flex gap-2 text-[12px] ${f.severity === "warn" ? "text-amber-100/90" : "text-ink-3"}`}>
                  <span aria-hidden="true">{f.severity === "warn" ? "!" : "·"}</span>
                  <span>{f.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] text-ink-3">No risk flags from Panta&apos;s current record and tape.</p>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Link href={cta.href} className="btn btn-primary">
            {cta.label} <IconArrowRight className="h-4 w-4" />
          </Link>
          <p className="min-w-0 flex-1 text-[12px] text-ink-3">{cta.detail}</p>
        </div>
      </div>
    </Panel>
  );
}
