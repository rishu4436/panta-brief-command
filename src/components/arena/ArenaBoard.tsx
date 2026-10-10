"use client";

import Link from "next/link";
import { useState } from "react";
import { useArenaPage } from "@/lib/arena/client";
import { forecasterPath, type PublicForecasterRow } from "@/lib/arena/public";
import { shortAddr } from "@/lib/format";
import { RoomApiError } from "@/lib/rooms/client";
import { Panel } from "../Panel";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import { StatusBadge } from "../ui/StatusBadge";
import { IconArrowRight, IconLayers } from "../ui/Icons";
import { ArenaMethodology } from "./Methodology";

const PAGE = 20;
const METHOD_DEFAULT = { minRankedMarkets: 5, priorScore: "75.00", priorWeight: 5 };

function Row({ r }: { r: PublicForecasterRow }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[3rem_minmax(0,1fr)_6rem_6rem_5rem_5rem]">
      <span className="font-num text-[15px] font-semibold text-ink-2">{r.rank !== null ? `#${r.rank}` : "—"}</span>
      <Link href={forecasterPath(r.wallet)} className="min-w-0 truncate font-addr text-[13px] text-ink hover:text-cyan-300" title={r.wallet}>
        {shortAddr(r.wallet, 6)}
      </Link>
      <span className="text-right font-num text-[15px] font-semibold text-ink sm:order-none" title="Adjusted score (used for ranking)">
        {r.adjustedScore}
      </span>
      <span className="col-span-3 col-start-2 text-[11px] text-ink-3 sm:hidden">
        avg {r.avgScore} · Brier {r.meanBrier} · {r.scoredMarkets} scored{r.pendingMarkets ? ` · ${r.pendingMarkets} pending` : ""}
      </span>
      <span className="hidden text-right font-num text-[13px] text-ink-2 sm:block">{r.avgScore}</span>
      <span className="hidden text-right font-num text-[13px] text-ink-2 sm:block">{r.meanBrier}</span>
      <span className="hidden text-right font-num text-[13px] text-ink-2 sm:block">{r.scoredMarkets}</span>
    </li>
  );
}

function Header() {
  return (
    <div className="hidden grid-cols-[3rem_minmax(0,1fr)_6rem_6rem_5rem_5rem] gap-x-3 border-b border-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3 sm:grid">
      <span>Rank</span>
      <span>Forecaster</span>
      <span className="text-right">Adj. score</span>
      <span className="text-right">Avg score</span>
      <span className="text-right">Mean Brier</span>
      <span className="text-right">Scored</span>
    </div>
  );
}

function Tier({ tier, title, subtitle, emptyTitle, emptyBody }: { tier: "ranked" | "provisional"; title: string; subtitle: string; emptyTitle: string; emptyBody: string }) {
  const [offset, setOffset] = useState(0);
  const q = useArenaPage(tier, offset, PAGE);
  const data = q.data;
  return (
    <Panel title={title} subtitle={subtitle} flush>
      {q.isPending ? (
        <div className="space-y-3 p-4" role="status" aria-label={`Loading ${title}`}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <div className="p-4">
          <ErrorState
            title={q.error instanceof RoomApiError && q.error.code === "ROOMS_STORE_UNCONFIGURED" ? "The arena isn't available on this deployment yet" : "Couldn't load the arena"}
            description={q.error instanceof Error ? q.error.message : "Try again."}
            onRetry={() => void q.refetch()}
          />
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<IconLayers className="h-5 w-5" />} title={emptyTitle} description={emptyBody} />
      ) : (
        <>
          <Header />
          <ol className="divide-y divide-line" aria-busy={q.isFetching}>
            {data.items.map((r) => (
              <Row key={r.wallet} r={r} />
            ))}
          </ol>
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
            <span className="font-num">
              {data.offset + 1}–{data.offset + data.items.length} of {data.total}
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm forecast-tap" disabled={data.offset === 0 || q.isFetching} onClick={() => setOffset(Math.max(0, data.offset - PAGE))}>
                ← Prev
              </button>
              <button type="button" className="btn btn-ghost btn-sm forecast-tap" disabled={data.offset + data.items.length >= data.total || q.isFetching} onClick={() => setOffset(data.offset + PAGE)}>
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

export function ArenaBoard() {
  const ranked = useArenaPage("ranked", 0, PAGE);
  const m = ranked.data?.methodology ?? METHOD_DEFAULT;
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Forecasting Arena</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Forecaster rankings</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
            Accuracy of community forecasts in Prediction Rooms, scored with the Brier rule only after a market&apos;s outcome is verified by Panta and on
            chain. No trading profits, no rewards: just calibration.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral" size="xs">Ranked at {m.minRankedMarkets}+ scored markets</StatusBadge>
          <Link href="/rooms" className="btn btn-primary">
            Forecast in a room <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <Tier
        tier="ranked"
        title="Ranked"
        subtitle={`${m.minRankedMarkets}+ verified scored markets`}
        emptyTitle="No ranked forecasters yet"
        emptyBody={`Nobody has ${m.minRankedMarkets} verified, scored markets yet. Scores appear only after markets resolve and both Panta and the on-chain record confirm the outcome.`}
      />
      <Tier
        tier="provisional"
        title="Provisional"
        subtitle={`Fewer than ${m.minRankedMarkets} scored markets · not ranked`}
        emptyTitle="No scored forecasts yet"
        emptyBody="When a market with room forecasts resolves and is verified, its forecasters appear here until they reach the ranking threshold."
      />
      <ArenaMethodology minRanked={m.minRankedMarkets} priorScore={m.priorScore} priorWeight={m.priorWeight} />
    </div>
  );
}
