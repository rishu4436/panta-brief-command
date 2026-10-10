"use client";

import { rawPriceNote } from "@/lib/panta/prices";
import { printsLabel, tapeState } from "@/lib/tape-status";
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
  categoryLabel,
} from "@/lib/format";
import { notifyStorage, pushRecent } from "@/lib/storage";
import { useCreateEvidence } from "@/lib/data/created";
import { useQuoteUnavailable } from "@/lib/data/reconcile";
import { browserCreatedMarkets } from "@/lib/panta/created-markets";
import { isMarketNotFound, isPantaIndexed, marketState } from "@/lib/panta/lifecycle";
import {
  AwaitingIndexingNote,
  AwaitingIndexingView,
  MarketStateStrip,
  RegistrationNeedsAttention,
  YourMarketPanel,
} from "./market/MarketCommand";
import { AiBrief } from "./AiBrief";
import { Panel } from "./Panel";
import { ProbabilityPanel } from "./desk/ProbabilityPanel";
import { PrimaryBuyPanel } from "./PrimaryBuyPanel";
import { SecondaryIntelligence } from "./SecondaryIntelligence";
import { showsSecondaryIntelligence } from "@/lib/panta/secondary-intel";
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
  // Loading / failed / empty / loaded are kept apart (a failure is never "0 prints").
  const tapeSt = tapeState({ ...trades, data: trades.data?.trades });
  // Some rows of the page unreadable: shown as a partial sample, never as zeros.
  const tapePartial = trades.data && !trades.data.completeness.complete ? trades.data.completeness : null;
  const retryTape = () => void trades.refetch();
  const load = () => void detail.refetch();

  // Canonical state (Stage D): Panta record first; local create evidence only
  // while Panta has no record; API failure ≠ closed; quote failure ≠ 0 %.
  const evidence = useCreateEvidence();
  const quoteUnavailable = useQuoteUnavailable(id);
  const createdRec = evidence.created.find((r) => r.marketId === id) ?? null;
  const needsRegistration = evidence.needsAttention.some((r) => r.expectedEventPda === id);
  const state = marketState({
    marketId: id,
    market,
    loading: busy && !market,
    error: detail.error,
    notFound: isMarketNotFound(detail.error),
    quoteUnavailable,
    createdEvidence: createdRec,
    registrationNeedsAttention: needsRegistration,
  });
  const indexed = isPantaIndexed(market);
  // Panta now returns the market: drop the local "awaiting indexing" evidence.
  useEffect(() => {
    if (indexed && createdRec) browserCreatedMarkets.prune([id]);
  }, [indexed, createdRec, id]);

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

  if (error && !market && !evidence.ready) {
    return (
      <div className="animate-fade-in" role="status" aria-label="Loading market">
        <DetailSkeleton />
      </div>
    );
  }

  if (!market && state.kind === "awaiting_indexing" && createdRec) {
    return (
      <AwaitingIndexingView
        marketId={id}
        signature={createdRec.signature}
        question={createdRec.question}
        checking={detail.isFetching}
        onCheck={load}
      />
    );
  }

  if (error && !market) {
    const notIndexed = isMarketNotFound(detail.error);
    return (
      <div className="mx-auto max-w-xl py-10">
        {state.kind === "registration_needs_attention" ? (
          <div className="mb-3">
            <RegistrationNeedsAttention marketId={id} />
          </div>
        ) : null}
        <ErrorState
          title={notIndexed ? "Market not indexed by Panta" : "Panta API unavailable"}
          description={
            <>
              {notIndexed ? "Panta has no market with this id. Check the link, or wait if it was just created." : `${error}. The market's status is unknown, not closed. Try again.`}
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

  const { yes, no, unavailable, probability } = impliedSide(market);
  const heading = marketLabel(market);
  const desc = (market.description || market.resolutionRule || "").trim();
  const descIsDupe =
    desc &&
    heading &&
    desc.slice(0, 80).toLowerCase() === heading.slice(0, 80).toLowerCase();
  const showDesc = desc && !descIsDupe;

  const vol = formatVolumeUsdc(catalogVolume(market));
  const secondaryDesk = showsSecondaryIntelligence(market);

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
            {shouldShowCategoryChip(market.category, market.title, market.description) ? (
              <span className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-3">{categoryLabel(market.category)}</span>
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

        <MarketStateStrip state={state} market={market} />

        {secondaryDesk ? (
          <p className="rounded-xl border border-line bg-inset/50 px-3 py-2 text-[12px] text-ink-3">
            Secondary phase — last observed secondary prices and flow are in Secondary Market Intelligence
            (right / below). Independent YES/NO prices are not shown as probabilities.
          </p>
        ) : (
          <ProbabilityPanel
            yes={yes}
            no={no}
            unavailable={unavailable}
            note={rawPriceNote(probability)}
            volume={vol}
            ends={market.endTime ? `${formatEnd(market.endTime)} IST` : "—"}
            resolves={market.resolutionTime ? `${formatEnd(market.resolutionTime)} IST` : "—"}
            prints={printsLabel(tapeSt)}
            {...(state.kind === "resolved"
              ? { title: "Settlement", subtitle: "Panta's final prices after resolution · not a live probability" }
              : {})}
          />
        )}

        <TapeSparkline state={tapeSt} onRetry={retryTape} size="lg" secondaryPhase={secondaryDesk} />
      </div>

      {/* Right: AI brief */}
      <div className="min-w-0 self-start lg:col-start-2 lg:row-span-3 lg:row-start-1 xl:col-start-3">
        <AiBrief market={market} auto />
      </div>

      {/* Centre: trade ticket */}
      <div className="min-w-0 self-start lg:col-start-1 lg:row-start-2 xl:col-start-2">
        {secondaryDesk ? (
          <SecondaryIntelligence
            market={market}
            trades={trades}
            marketUpdatedAt={updatedAt}
            marketFetching={detail.isFetching}
            marketError={Boolean(detail.error)}
          />
        ) : state.kind === "registration_needs_attention" ? (
          <RegistrationNeedsAttention marketId={market.marketId} />
        ) : state.kind === "awaiting_indexing" ? (
          <AwaitingIndexingNote onCheck={load} checking={detail.isFetching} />
        ) : (
          <PrimaryBuyPanel initialMarketId={market.marketId} compact market={market} />
        )}
      </div>

      {/* Centre: activity + context */}
      <div className="min-w-0 space-y-4 self-start lg:col-start-1 lg:row-start-3 xl:col-start-2">
        {tapePartial && (
          <p role="status" className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
            Partial tape: {tapePartial.dropped} of {tapePartial.returned} rows from Panta could not be read and are left out.
            Counts and flow cover the {tapePartial.parsed} readable rows only.
          </p>
        )}
        <YourMarketPanel market={market} />
        <TradeTape state={tapeSt} onRetry={retryTape} />

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
