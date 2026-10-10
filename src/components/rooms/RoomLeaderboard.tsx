"use client";

import Link from "next/link";
import { useState } from "react";
import { useRoomLeaderboard } from "@/lib/arena/client";
import { forecasterPath } from "@/lib/arena/public";
import { formatBpsPercent } from "@/lib/forecasts/domain";
import type { PublicForecast } from "@/lib/forecasts/domain";
import { formatFriendlyIst, shortAddr } from "@/lib/format";
import { Panel } from "../Panel";
import { ErrorState, Skeleton } from "../ui/States";
import { StatusBadge } from "../ui/StatusBadge";

const PAGE = 20;

function Pager({ offset, count, total, busy, onPage }: { offset: number; count: number; total: number; busy: boolean; onPage: (o: number) => void }) {
  if (offset === 0 && count >= total) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-ink-3">
      <span className="font-num">
        {offset + 1}–{offset + count} of {total}
      </span>
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost btn-sm forecast-tap" disabled={offset === 0 || busy} onClick={() => onPage(Math.max(0, offset - PAGE))}>
          ← Prev
        </button>
        <button type="button" className="btn btn-ghost btn-sm forecast-tap" disabled={offset + count >= total || busy} onClick={() => onPage(offset + PAGE)}>
          Next →
        </button>
      </div>
    </div>
  );
}

function PendingList({ forecasts, total }: { forecasts: PublicForecast[]; total: number }) {
  if (!total) return <p className="text-[12px] text-ink-3">No forecasts in this room yet. Every forecast saved before the cutoff will be scored after verified resolution.</p>;
  return (
    <>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        Pending forecasts · {total} · not ranked until resolution
      </p>
      <ul className="divide-y divide-line">
        {forecasts.map((f) => (
          <li key={f.wallet} className="flex items-center gap-3 py-2">
            <Link href={forecasterPath(f.wallet)} className="min-w-0 truncate font-addr text-[12px] text-ink-2 hover:text-cyan-300" title={f.wallet}>
              {shortAddr(f.wallet, 4)}
            </Link>
            <span className="text-[11px] text-ink-3">rev {f.revision}</span>
            <span className="ml-auto font-num text-[13px] font-semibold text-ink">{formatBpsPercent(f.probabilityBps)}</span>
            <StatusBadge tone="pending" size="xs">Pending</StatusBadge>
          </li>
        ))}
      </ul>
    </>
  );
}

export function RoomLeaderboard({ slug }: { slug: string }) {
  const [offset, setOffset] = useState(0);
  const q = useRoomLeaderboard(slug, offset);
  const d = q.data;
  return (
    <Panel id="leaderboard" title="Room leaderboard" subtitle={d?.status === "scored" ? "Verified & final" : d?.status === "blocked" ? "Blocked" : "Brier accuracy"}>
      {q.isPending ? (
        <div className="space-y-2" role="status" aria-label="Loading leaderboard">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : q.isError || !d ? (
        <ErrorState title="Couldn't load the leaderboard" description={q.error instanceof Error ? q.error.message : "Try again."} onRetry={() => void q.refetch()} />
      ) : d.status === "in_progress" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-3">
            <p className="text-[13px] font-medium text-ink">{d.message}</p>
            <p className="mt-1 text-[12px] text-ink-3">
              Each wallet&apos;s last forecast before the cutoff is scored once Panta and the on-chain market record agree on the outcome.{" "}
              <Link href="/arena#methodology" className="text-cyan-300 hover:underline">
                How scoring works
              </Link>
            </p>
          </div>
          <PendingList forecasts={d.pending.forecasts} total={d.pending.total} />
          <Pager offset={d.pending.offset} count={d.pending.forecasts.length} total={d.pending.total} busy={q.isFetching} onPage={setOffset} />
        </div>
      ) : d.status === "blocked" ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3" role="status">
            <p className="text-[13px] font-medium text-amber-200">Finalization blocked</p>
            <p className="mt-1 text-[12px] text-ink-2">{d.message}</p>
            <p className="mt-1 font-num text-[11px] text-ink-3">Recorded {formatFriendlyIst(d.finalizedAt)}</p>
          </div>
          <PendingList forecasts={d.pending.forecasts} total={d.pending.total} />
          <Pager offset={d.pending.offset} count={d.pending.forecasts.length} total={d.pending.total} busy={q.isFetching} onPage={setOffset} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            <StatusBadge tone="info" size="xs">
              Resolved {d.outcome.toUpperCase()}
            </StatusBadge>
            <span>
              Verified {formatFriendlyIst(d.finalizedAt)} · Panta record + on-chain account
              {d.provenance.chain.slot !== null ? <span className="font-num"> (slot {d.provenance.chain.slot})</span> : null}
            </span>
          </div>
          {d.total === 0 ? (
            <p className="text-[12px] text-ink-3">No forecast in this room was made before the cutoff, so nobody here was scored.</p>
          ) : (
            <ol className="divide-y divide-line">
              {d.scores.map((s) => (
                <li key={s.wallet} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2">
                  <span className="font-num text-[14px] font-semibold text-ink-2">#{s.rank}</span>
                  <span className="min-w-0">
                    <Link href={forecasterPath(s.wallet)} className="block truncate font-addr text-[12px] text-ink hover:text-cyan-300" title={s.wallet}>
                      {shortAddr(s.wallet, 5)}
                    </Link>
                    <span className="text-[11px] text-ink-3">
                      {formatBpsPercent(s.probabilityBps)} YES · rev {s.forecastRevision} · Brier <span className="font-num">{s.brier}</span>
                    </span>
                  </span>
                  <span className="text-right font-num text-[16px] font-semibold text-ink">{s.score}</span>
                </li>
              ))}
            </ol>
          )}
          <Pager offset={d.offset} count={d.scores.length} total={d.total} busy={q.isFetching} onPage={setOffset} />
        </div>
      )}
    </Panel>
  );
}
