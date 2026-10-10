"use client";

import Link from "next/link";
import { useState } from "react";
import { formatFriendlyIst } from "@/lib/format";
import { RoomApiError } from "@/lib/rooms/client";
import { useStudioOverview, useStudioRooms, type StudioRoomsQuery } from "@/lib/studio/client";
import { DEFINITIONS, MAX_STUDIO_ROOMS, type StudioOverview, type StudioRoomRow } from "@/lib/studio/domain";
import { Panel } from "../Panel";
import { EmptyState, ErrorState, SkeletonLoader } from "../ui/States";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";
import { IconSearch } from "../ui/Icons";
import { ChartFrame, ChartState, DailyBars, HBars } from "./StudioCharts";
import { StudioGate } from "./StudioGate";
import { formatPct, InsightsList, Metric, useCopy } from "./StudioParts";

function storeErrorTitle(e: unknown) {
  return e instanceof RoomApiError && e.code === "ROOMS_STORE_UNCONFIGURED" ? "Rooms storage isn't configured here" : "Couldn't load Creator Studio";
}

function Overview({ o }: { o: StudioOverview }) {
  const p = o.participation;
  const d = o.distribution;
  const days = p.newForecastersByDay.map((x) => x.day);
  const anyNew = p.newForecastersByDay.some((x) => x.count > 0);
  return (
    <div className="space-y-4">
      <Panel title="Overview" subtitle={`Your ${o.rooms.total} room${o.rooms.total === 1 ? "" : "s"}${o.rooms.truncated ? ` (newest ${MAX_STUDIO_ROOMS})` : ""}`}>
        <div className="space-y-4">
          <section aria-labelledby="ov-rooms">
            <h3 id="ov-rooms" className="mb-2 text-[12px] font-semibold text-ink-2">
              Rooms
            </h3>
            <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Metric label="Total rooms" value={o.rooms.total} definition={`${o.rooms.public} public · ${o.rooms.unlisted} unlisted`} />
              <Metric label="Active" value={o.rooms.active} definition="Open to visitors and forecasts (market permitting)." />
              <Metric label="Archived" value={o.rooms.archived} definition="Hidden from everyone but you; history kept." />
              <Metric label="Finalized" value={p.finalizedRooms} definition="Rooms whose market result was verified (scored or blocked)." />
            </dl>
          </section>
          <section aria-labelledby="ov-part">
            <h3 id="ov-part" className="mb-1 text-[12px] font-semibold text-ink-2">
              Participation <span className="font-normal text-ink-3">· from durable forecast records, all time</span>
            </h3>
            {p.approximate ? <p className="mb-2 text-[11px] text-amber-200/90">Some counts are approximate: the one-time index rebuild hit its scan limit.</p> : null}
            <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Metric label="Forecasting wallets" value={p.uniqueForecasters} definition={DEFINITIONS.uniqueForecasters} />
              <Metric label="Returning wallets" value={p.returningForecasters} definition={DEFINITIONS.returningForecasters} />
              <Metric label="Current forecasts" value={p.currentForecasts} definition={DEFINITIONS.currentForecasts} />
              <Metric label="Revisions" value={p.revisions} definition={DEFINITIONS.revisions} />
              <Metric label="Scored" value={p.scoredForecasts} definition={DEFINITIONS.scored} />
              <Metric label="Pending" value={p.pendingForecasts} definition={DEFINITIONS.pending} sub={p.unscoredBlocked ? `+${p.unscoredBlocked} blocked` : undefined} />
              <Metric label="Debate challenges" value={p.challenges} definition={DEFINITIONS.challenges} />
            </dl>
          </section>
          <section aria-labelledby="ov-dist">
            <h3 id="ov-dist" className="mb-1 text-[12px] font-semibold text-ink-2">
              Distribution <span className="font-normal text-ink-3">· approximate, last 30 UTC days{d.tracked && d.value.since ? `, data since ${d.value.since}` : ""}</span>
            </h3>
            <dl className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              <Metric label="Observed room views" value={d.tracked ? d.value.views : null} definition={DEFINITIONS.views} />
              <Metric label="Embed requests (approx.)" value={d.tracked ? d.value.embedRequests : null} definition={DEFINITIONS.embedRequests} />
              <Metric label="Widget click-throughs" value={d.tracked ? d.value.ctaClicks : null} definition={DEFINITIONS.ctaClicks} />
            </dl>
            {!d.tracked ? <p className="mt-2 text-[11px] text-ink-3">{d.reason}</p> : null}
          </section>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Participation over time" subtitle="New forecasting wallets per UTC day">
          {anyNew ? (
            <ChartFrame title="New forecasting wallets" description={DEFINITIONS.newForecasters}>
              <DailyBars days={days} label="New forecasting wallets per day" series={[{ name: "New wallets", className: "fill-cyan-400/85", values: p.newForecastersByDay.map((x) => x.count) }]} />
            </ChartFrame>
          ) : (
            <ChartState kind={p.uniqueForecasters ? "sparse" : "empty"}>
              {p.uniqueForecasters ? "No wallet forecast in your rooms for the first time in the last 30 days." : "No forecasts in your rooms yet."}
            </ChartState>
          )}
        </Panel>
        <Panel title="Traffic over time" subtitle="Observed views, embed requests, click-throughs">
          {d.tracked ? (
            <ChartFrame title="Daily distribution counters" description="Bots filtered; repeats counted once per browser, room and UTC day. Embed requests undercount behind the CDN.">
              <DailyBars
                days={d.value.byDay.map((x) => x.day)}
                label="Distribution counters per day"
                series={[
                  { name: "Views", className: "fill-cyan-400/85", values: d.value.byDay.map((x) => x.views) },
                  { name: "Embed requests", className: "fill-violet-400/80", values: d.value.byDay.map((x) => x.embedRequests) },
                  { name: "Click-throughs", className: "fill-emerald-400/80", values: d.value.byDay.map((x) => x.ctaClicks) },
                ]}
              />
            </ChartFrame>
          ) : (
            <ChartState kind={d.reason.includes("storage error") ? "error" : "empty"}>{d.reason}</ChartState>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Activity by room" subtitle="Current forecasts per room (top 8)">
          {o.activityByRoom.some((r) => r.currentForecasts > 0) ? (
            <HBars
              label="Current forecasts per room"
              unit="forecasts"
              rows={[...o.activityByRoom]
                .sort((a, b) => b.currentForecasts - a.currentForecasts)
                .slice(0, 8)
                .map((r) => ({ key: r.roomId, label: r.title, value: r.currentForecasts, href: `/studio/rooms/${encodeURIComponent(r.slug)}` }))}
            />
          ) : (
            <ChartState kind="empty">{o.rooms.total ? "None of your rooms has a forecast yet." : "You don't own any rooms yet."}</ChartState>
          )}
        </Panel>
        <Panel title="Where visitors come from" subtitle="Observed views by source">
          {d.tracked && d.value.sources.length ? (
            <HBars label="Observed views by source" unit="views" rows={d.value.sources.slice(0, 8).map((s) => ({ key: s.key, label: s.label, value: s.count }))} />
          ) : (
            <ChartState kind="empty">{d.tracked ? "No room views observed yet; only embed requests were recorded." : d.reason}</ChartState>
          )}
          <p className="mt-2 text-[11px] text-ink-3">Host names only. Many apps send no referrer, so their visits show as direct.</p>
        </Panel>
      </div>

      <Panel title="Insights" subtitle="Rules over the numbers above. No AI.">
        <InsightsList insights={o.insights} />
      </Panel>
    </div>
  );
}

const STATUS_TONE: Record<StudioRoomRow["forecasting"], StatusTone> = { open: "live", closed: "neutral", archived: "neutral", unknown: "pending" };
const STATUS_TEXT: Record<StudioRoomRow["forecasting"], string> = { open: "Forecasting open", closed: "Forecasting closed", archived: "Archived", unknown: "Market status unknown" };

function RoomRowCard({ r }: { r: StudioRoomRow }) {
  const { copy, label } = useCopy();
  const manage = `/studio/rooms/${encodeURIComponent(r.slug)}`;
  return (
    <li className="rounded-xl border border-line bg-inset/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link href={manage} className="block truncate text-[14px] font-semibold text-ink hover:underline">
            {r.title}
          </Link>
          <p className="mt-0.5 truncate text-[12px] text-ink-3" title={r.marketTitle ?? r.marketId}>
            {r.marketTitle ?? "Market title unavailable"} · {r.lifecycleLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge tone={r.status === "archived" ? "neutral" : "success"} size="xs">
            {r.status === "archived" ? "Archived" : "Active"}
          </StatusBadge>
          <StatusBadge tone="neutral" size="xs">
            {r.visibility === "public" ? "Public" : "Unlisted"}
          </StatusBadge>
          <StatusBadge tone={STATUS_TONE[r.forecasting]} size="xs">
            {r.finalization === "scored" ? "Scored" : r.finalization === "blocked" ? "Blocked" : STATUS_TEXT[r.forecasting]}
          </StatusBadge>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <dt className="text-ink-3">Forecasters</dt>
          <dd className="font-num text-ink">{r.participants}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Community</dt>
          <dd className="font-num text-ink">{r.communityMeanBps === null ? "No forecasts" : `${formatPct(r.communityMeanBps)} YES`}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Created</dt>
          <dd className="font-num text-ink-2">{formatFriendlyIst(r.createdAt).replace(/, \d{4}/, "")}</dd>
        </div>
      </dl>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Link href={manage} className="btn btn-primary btn-sm">
          Manage &amp; analytics
        </Link>
        {r.status === "active" ? (
          <>
            <a href={r.roomPath} className="btn btn-ghost btn-sm">
              Open room
            </a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy("link", `${window.location.origin}${r.roomPath}`)}>
              {label("link", "Copy share link")}
            </button>
            <Link href={`${manage}#embed`} className="btn btn-ghost btn-sm">
              Embed
            </Link>
          </>
        ) : (
          <span className="self-center text-[11px] text-ink-3">Hidden from visitors while archived</span>
        )}
      </div>
    </li>
  );
}

function MyRooms({ wallet }: { wallet: string }) {
  const [p, setP] = useState<StudioRoomsQuery>({ q: "", status: "all", page: 1 });
  const [qDraft, setQDraft] = useState("");
  const rooms = useStudioRooms(wallet, p);
  const data = rooms.data;
  return (
    <Panel title="My rooms" subtitle="Every room your wallet created, including archived ones">
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setP((x) => ({ ...x, q: qDraft.trim(), page: 1 }));
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Search</span>
          <span className="relative block">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input value={qDraft} onChange={(e) => setQDraft(e.target.value)} maxLength={80} placeholder="Title, address or description" className="field w-full !pl-8" />
          </span>
        </label>
        <label className="w-36">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Status</span>
          <select className="field" value={p.status} onChange={(e) => setP((x) => ({ ...x, status: e.target.value as StudioRoomsQuery["status"], page: 1 }))}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
          </select>
        </label>
        <button type="submit" className="btn btn-ghost">
          Search
        </button>
      </form>
      {rooms.isPending ? (
        <SkeletonLoader rows={3} label="Loading your rooms" />
      ) : rooms.isError ? (
        <ErrorState title={storeErrorTitle(rooms.error)} description={rooms.error instanceof Error ? rooms.error.message : "Try again."} onRetry={() => void rooms.refetch()} />
      ) : !data || data.total === 0 ? (
        p.q || p.status !== "all" ? (
          <EmptyState title="No rooms match" description="Try a different search or status." />
        ) : (
          <EmptyState
            title="You haven't created a room yet"
            description="Create a room around a live Panta market, share it, and its numbers show up here."
            action={
              <Link href="/rooms/create" className="btn btn-primary">
                Create a room
              </Link>
            }
          />
        )
      ) : (
        <>
          <ul className={`space-y-2.5 ${rooms.isFetching ? "opacity-70" : ""}`} aria-busy={rooms.isFetching}>
            {data.items.map((r) => (
              <RoomRowCard key={r.roomId} r={r} />
            ))}
          </ul>
          <nav className="mt-3 flex items-center justify-between gap-2 text-[12px] text-ink-3" aria-label="Rooms pages">
            <span>
              {data.total} room{data.total === 1 ? "" : "s"} · page {data.page} of {data.pages}
              {data.truncated ? ` · showing your newest ${MAX_STUDIO_ROOMS}` : ""}
            </span>
            <span className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" disabled={data.page <= 1} onClick={() => setP((x) => ({ ...x, page: x.page - 1 }))}>
                Previous
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={data.page >= data.pages} onClick={() => setP((x) => ({ ...x, page: x.page + 1 }))}>
                Next
              </button>
            </span>
          </nav>
        </>
      )}
    </Panel>
  );
}

function Dashboard({ wallet }: { wallet: string }) {
  const overview = useStudioOverview(wallet);
  return (
    <div className="space-y-4">
      {overview.isPending ? (
        <SkeletonLoader rows={4} label="Loading your studio" />
      ) : overview.isError ? (
        <ErrorState title={storeErrorTitle(overview.error)} description={overview.error instanceof Error ? overview.error.message : "Try again."} onRetry={() => void overview.refetch()} />
      ) : (
        <Overview o={overview.data} />
      )}
      <MyRooms wallet={wallet} />
    </div>
  );
}

export function StudioWorkspace() {
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Creators</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Creator Studio</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
            Your rooms, how people forecast in them, and how they find them. Wallet counts are wallets, not people. Distribution numbers are approximate and start from
            this release.
          </p>
        </div>
        <Link href="/rooms/create" className="btn btn-primary">
          Create Room
        </Link>
      </div>
      <StudioGate>{(wallet) => <Dashboard wallet={wallet} />}</StudioGate>
    </div>
  );
}
