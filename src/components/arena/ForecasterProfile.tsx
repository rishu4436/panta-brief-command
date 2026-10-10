"use client";

import Link from "next/link";
import { useState } from "react";
import { useForecasterProfile, type ForecasterProfileResponse } from "@/lib/arena/client";
import { formatBpsPercent } from "@/lib/forecasts/domain";
import { formatFriendlyIst, shortAddr } from "@/lib/format";
import { marketHref } from "@/lib/panta/lifecycle";
import { RoomApiError } from "@/lib/rooms/client";
import { roomPath } from "@/lib/rooms/domain";
import { Panel } from "../Panel";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import { StatusBadge } from "../ui/StatusBadge";
import { IconLayers } from "../ui/Icons";
import { AccuracySparkline } from "./AccuracySparkline";

type Profile = ForecasterProfileResponse;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-inset/50 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</dt>
      <dd className="mt-1 font-num text-[20px] font-semibold text-ink">{value}</dd>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

function MarketLink({ marketId, title }: { marketId: string; title: string | null }) {
  return (
    <Link href={marketHref(marketId)} className="line-clamp-2 text-[13px] text-ink-2 hover:text-cyan-300">
      {title ?? <span className="font-addr">Market {shortAddr(marketId, 4)}</span>}
    </Link>
  );
}

function RoomName({ slug, title }: { slug: string | null; title: string | null }) {
  return slug && title ? (
    <Link href={roomPath(slug)} className="font-semibold text-ink hover:text-cyan-300">
      {title}
    </Link>
  ) : (
    <span className="font-semibold text-ink-3">Room not listed</span>
  );
}

function RoomsSection({ rooms }: { rooms: Profile["rooms"] }) {
  return (
    <Panel title="Rooms & forecasts" subtitle="Current forecast, revision history and room score">
      {rooms.length === 0 ? (
        <p className="text-[12px] text-ink-3">This wallet hasn&apos;t forecast in any room yet.</p>
      ) : (
        <ul className="space-y-3">
          {rooms.map((r) => (
            <li key={r.roomId} className="rounded-xl border border-line bg-inset/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 text-[13px]">
                  <RoomName slug={r.roomSlug} title={r.roomTitle} />
                  <MarketLink marketId={r.marketId} title={r.marketTitle} />
                </div>
                {r.marketStatus === "scored" ? (
                  <StatusBadge tone="success" size="xs">Finalized</StatusBadge>
                ) : r.marketStatus === "blocked" ? (
                  <StatusBadge tone="warning" size="xs">Blocked · sources disagree</StatusBadge>
                ) : (
                  <StatusBadge tone="pending" size="xs">Pending verified resolution</StatusBadge>
                )}
              </div>
              <div className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">Current forecast</p>
                  {r.current ? (
                    <p className="mt-0.5 text-ink-2">
                      <span className="font-num text-[15px] font-semibold text-ink">{formatBpsPercent(r.current.probabilityBps)}</span> YES · revision {r.current.revision} ·{" "}
                      <span className="font-num">{formatFriendlyIst(r.current.updatedAt)}</span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-ink-3">None</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">Finalized score</p>
                  {r.roomScore ? (
                    <p className="mt-0.5 text-ink-2">
                      <span className="font-num text-[15px] font-semibold text-ink">{r.roomScore.score}</span> · resolved {r.roomScore.outcome.toUpperCase()} · scored rev{" "}
                      {r.roomScore.forecastRevision} ({formatBpsPercent(r.roomScore.probabilityBps)}) · Brier <span className="font-num">{r.roomScore.brier}</span>
                      {r.countsGlobally ? (
                        <span className="ml-1 text-cyan-300">· counts toward reputation</span>
                      ) : (
                        <span className="ml-1 text-ink-3">· room only (an earlier room counts globally)</span>
                      )}
                    </p>
                  ) : r.marketStatus === "scored" ? (
                    <p className="mt-0.5 text-ink-3">Not scored (no forecast before the cutoff).</p>
                  ) : (
                    <p className="mt-0.5 text-ink-3">Not scored yet. Scores appear after verified resolution.</p>
                  )}
                </div>
              </div>
              {r.revisions.length > 1 ? (
                <details className="mt-2 text-[12px]">
                  <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Revision history ({r.revisions.length})</summary>
                  <ol className="mt-1 space-y-0.5">
                    {r.revisions.map((v) => (
                      <li key={v.revision} className="flex gap-3 text-ink-2">
                        <span className="w-12 text-ink-3">rev {v.revision}</span>
                        <span className="w-16 font-num">{formatBpsPercent(v.probabilityBps)}</span>
                        <span className="font-num text-ink-3">{formatFriendlyIst(v.createdAt)}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ScoresSection({ p, onPage, busy }: { p: Profile; onPage: (o: number) => void; busy: boolean }) {
  const s = p.scores;
  const chrono = [...s.items].sort((a, b) => a.finalizedAt.localeCompare(b.finalizedAt));
  return (
    <Panel title="Scored markets" subtitle="Global record · one score per market">
      {s.total === 0 ? (
        <p className="text-[12px] text-ink-3">No verified scored markets yet. Forecasts are scored only after a market resolves and both Panta and the on-chain record confirm the outcome.</p>
      ) : (
        <>
          {chrono.length > 1 ? (
            <div className="mb-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">Accuracy history (this page) · dashed line = 75, always-50%</p>
              <AccuracySparkline points={chrono.map((x) => ({ scoreC: x.scoreC, at: x.finalizedAt }))} label="Score per scored market, oldest to newest" />
            </div>
          ) : null}
          <ul className="divide-y divide-line">
            {s.items.map((x) => (
              <li key={`${x.marketId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                <div className="min-w-0 text-[12px]">
                  <MarketLink marketId={x.marketId} title={x.marketTitle} />
                  <p className="text-ink-3">
                    {formatBpsPercent(x.probabilityBps)} YES → resolved {x.outcome.toUpperCase()} · Brier <span className="font-num">{x.brier}</span> ·{" "}
                    {x.roomSlug && x.roomTitle ? (
                      <Link href={roomPath(x.roomSlug)} className="hover:text-ink-2">
                        {x.roomTitle}
                      </Link>
                    ) : (
                      "room not listed"
                    )}{" "}
                    · <span className="font-num">{formatFriendlyIst(x.finalizedAt)}</span>
                  </p>
                </div>
                <span className="font-num text-[16px] font-semibold text-ink">{x.score}</span>
              </li>
            ))}
          </ul>
          {s.offset > 0 || s.offset + s.items.length < s.total ? (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm forecast-tap" disabled={s.offset === 0 || busy} onClick={() => onPage(Math.max(0, s.offset - s.limit))}>
                ← Newer
              </button>
              <button type="button" className="btn btn-ghost btn-sm forecast-tap" disabled={s.offset + s.items.length >= s.total || busy} onClick={() => onPage(s.offset + s.limit)}>
                Older →
              </button>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

export function ForecasterProfile({ wallet }: { wallet: string }) {
  const [offset, setOffset] = useState(0);
  const q = useForecasterProfile(wallet, offset);
  const p = q.data;
  const rep = p?.reputation ?? null;
  return (
    <div className="space-y-5 animate-fade-in">
      <Link href="/arena" className="type-back inline-flex min-h-8 items-center transition">
        ← Arena
      </Link>
      <header className="card overflow-hidden">
        <div className="bg-gradient-to-br from-cyan-400/[0.06] via-transparent to-violet-500/[0.05] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">Forecaster</p>
            {rep?.ranked && rep.rank ? (
              <StatusBadge tone="live" size="xs">Ranked #{rep.rank}</StatusBadge>
            ) : rep ? (
              <StatusBadge tone="neutral" size="xs">
                Provisional · {rep.scoredMarkets}/{p?.rankedThreshold ?? 5} scored
              </StatusBadge>
            ) : p ? (
              <StatusBadge tone="neutral" size="xs">No scored markets yet</StatusBadge>
            ) : null}
          </div>
          <h1 className="mt-2 break-all font-addr text-[18px] font-semibold text-ink sm:text-[22px]">{wallet}</h1>
          <p className="mt-1 text-[12px] text-ink-3">Public, pseudonymous wallet record. Accuracy only: no trading activity or balances are shown.</p>
        </div>
      </header>

      {q.isPending ? (
        <div className="grid gap-3 sm:grid-cols-3" role="status" aria-label="Loading profile">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : q.isError || !p ? (
        <ErrorState
          title={q.error instanceof RoomApiError && q.error.code === "ROOMS_STORE_UNCONFIGURED" ? "Profiles aren't available on this deployment yet" : "Couldn't load this profile"}
          description={q.error instanceof Error ? q.error.message : "Try again."}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Adjusted score" value={rep ? rep.adjustedScore : "—"} hint={rep ? (rep.ranked ? "Used for ranking" : "Provisional") : "After first scored market"} />
            <Stat label="Avg score" value={rep ? rep.avgScore : "—"} hint="100 × (1 − Brier)" />
            <Stat label="Mean Brier" value={rep ? rep.meanBrier : "—"} hint="Lower is better" />
            <Stat label="Scored markets" value={String(p.scoredMarkets)} hint={`Ranked at ${p.rankedThreshold}+`} />
            <Stat label="Pending markets" value={String(p.pendingMarkets)} hint="Awaiting verified resolution" />
            <Stat label="Last scored" value={rep ? formatFriendlyIst(rep.lastScoredAt).replace(/, \d{4}.*/, "") : "—"} />
          </dl>
          {p.scoredMarkets === 0 && p.rooms.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<IconLayers className="h-5 w-5" />}
                title="No forecasts yet"
                description="This wallet hasn't made a room forecast. Profiles fill in from verified forecasts only."
                action={
                  <Link href="/rooms" className="btn btn-primary">
                    Browse rooms
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              <RoomsSection rooms={p.rooms} />
              <ScoresSection p={p} onPage={setOffset} busy={q.isFetching} />
            </div>
          )}
          <p className="text-[12px] text-ink-3">
            <Link href="/arena#methodology" className="text-cyan-300 hover:underline">
              How scores are computed
            </Link>{" "}
            · Finalized scores are immutable.
          </p>
        </>
      )}
    </div>
  );
}
