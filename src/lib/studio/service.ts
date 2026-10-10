import "server-only";

/**
 * Creator Growth Studio service: every function takes the VERIFIED session
 * wallet (never a wallet from the request) and only ever reads rooms whose
 * creatorWallet equals it. See docs/CREATOR_STUDIO.md.
 */

import type { FinalizationRecord } from "@/lib/arena/types";
import { getMarketSnapshot, type MarketSnapshot } from "@/lib/embed/market-snapshot";
import { DEFAULT_EMBED_OPTIONS } from "@/lib/embed/options";
import { embedUrl } from "@/lib/embed/snippet";
import { consensusFrom, type ForecastAggregate } from "@/lib/forecasts/domain";
import type { ForecastWindow } from "@/lib/forecasts/window";
import { forecastEligibility } from "@/lib/forecasts/window-public";
import { LIFECYCLE_LABEL, marketLifecycle } from "@/lib/panta/catalog";
import { roomPath, type RoomRecord } from "@/lib/rooms/domain";
import type { RoomRepository } from "@/lib/rooms/store";
import {
  DAY_RE,
  MAX_STUDIO_ROOMS,
  METRIC,
  NOT_TRACKED,
  recentDays,
  sourceLabel,
  STUDIO_PAGE_SIZE,
  STUDIO_SCHEMA_VERSION,
  STUDIO_WINDOW_DAYS,
  utcDay,
  type DistributionTotals,
  type StudioOverview,
  type StudioRoomAnalytics,
  type StudioRoomRow,
  type StudioRoomsPage,
  type Tracked,
} from "./domain";
import { buildInsights } from "./insights";
import type { CounterRow } from "./types";

export type StudioDeps = {
  repo: RoomRepository;
  now: () => number;
  origin: string;
  snapshot?: (marketId: string) => Promise<MarketSnapshot>;
  /**
   * The SAME server window check the room's forecast panel uses (read path;
   * writes always re-check fresh). Absent → Studio never claims "open".
   */
  window?: (marketId: string, nowMs: number) => Promise<ForecastWindow>;
};

/** New-forecaster times read for the daily chart (bounded). */
const MAX_FIRST_TIMES = 5000;
/** Parallel per-room reads. */
const CONCURRENCY = 8;
/** Market snapshot wait per room in lists (cached; slow Panta never blocks the Studio). */
const SNAPSHOT_WAIT_MS = 800;
/** Forecast window wait per room; slower → "Forecasting paused" (never "open"). */
const WINDOW_WAIT_MS = 3_000;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function loadCreatorRooms(repo: RoomRepository, wallet: string): Promise<{ rooms: RoomRecord[]; truncated: boolean }> {
  const rows = (await repo.listCreatorRoomsAll(wallet, { limit: MAX_STUDIO_ROOMS + 1 })).filter((r) => r.creatorWallet === wallet);
  return { rooms: rows.slice(0, MAX_STUDIO_ROOMS), truncated: rows.length > MAX_STUDIO_ROOMS };
}

type RoomFacts = { room: RoomRecord; aggregate: ForecastAggregate; finalization: FinalizationRecord | null; scored: number; challenges: number };

async function roomFacts(repo: RoomRepository, rooms: RoomRecord[]): Promise<RoomFacts[]> {
  const finals = new Map<string, Promise<FinalizationRecord | null>>();
  const finalFor = (marketId: string) => {
    if (!finals.has(marketId)) finals.set(marketId, repo.getFinalization(marketId));
    return finals.get(marketId)!;
  };
  return mapLimit(rooms, CONCURRENCY, async (room) => {
    const [aggregate, finalization, challenges] = await Promise.all([repo.getForecastAggregate(room.roomId), finalFor(room.marketId), repo.countRoomChallenges(room.roomId)]);
    const scored = finalization?.status === "scored" ? (await repo.listRoomScores(room.roomId, { limit: 1, offset: 0 })).total : 0;
    return { room, aggregate, finalization, scored, challenges };
  });
}

// ------------------------------------------------------------------ distribution

export function summarizeDistribution(rows: CounterRow[], days: string[], roomId?: string): Tracked<DistributionTotals> {
  const mine = rows.filter((r) => (roomId ? r.roomId === roomId : true) && days.includes(r.day) && DAY_RE.test(r.day));
  if (!mine.length) {
    return {
      tracked: false,
      reason: `${NOT_TRACKED}: nothing recorded in the last ${days.length} days. Distribution counting started with Creator Studio; earlier traffic was never recorded.`,
    };
  }
  const byDay = new Map(days.map((d) => [d, { day: d, views: 0, embedRequests: 0, ctaClicks: 0 }]));
  const sources = new Map<string, number>();
  const campaigns = new Map<string, number>();
  let views = 0;
  let embedRequests = 0;
  let ctaClicks = 0;
  for (const r of mine) {
    const d = byDay.get(r.day)!;
    if (r.metric === METRIC.view) {
      views += r.count;
      d.views += r.count;
    } else if (r.metric === METRIC.embed) {
      embedRequests += r.count;
      d.embedRequests += r.count;
    } else if (r.metric === METRIC.cta) {
      ctaClicks += r.count;
      d.ctaClicks += r.count;
    } else if (r.metric.startsWith("src:")) sources.set(r.metric, (sources.get(r.metric) ?? 0) + r.count);
    else if (r.metric.startsWith("c:")) campaigns.set(r.metric.slice(2), (campaigns.get(r.metric.slice(2)) ?? 0) + r.count);
  }
  const since = mine.map((r) => r.day).sort()[0] ?? null;
  return {
    tracked: true,
    value: {
      since,
      views,
      embedRequests,
      ctaClicks,
      sources: [...sources.entries()].map(([key, count]) => ({ key, label: sourceLabel(key), count })).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1)),
      campaigns: [...campaigns.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1)),
      byDay: [...byDay.values()],
    },
  };
}

async function distributionFor(deps: StudioDeps, wallet: string, days: string[]): Promise<{ rows: CounterRow[]; error: boolean }> {
  try {
    return { rows: await deps.repo.listStudioCounters(wallet, { days }), error: false };
  } catch {
    return { rows: [], error: true };
  }
}

// ------------------------------------------------------------------ rows

/**
 * Studio's forecasting badge = the room panel's eligibility (forecastEligibility
 * over the same server window). A market snapshot alone can never say "open":
 * it's a cache, and the secondary phase is closed for forecasting.
 */
export function forecastingState(room: RoomRecord, fin: FinalizationRecord | null, window: ForecastWindow | null): StudioRoomRow["forecasting"] {
  if (room.status === "archived") return "archived";
  if (fin) return "closed";
  return forecastEligibility(window ? { open: window.open, reason: window.open ? null : window.reason } : null);
}

export function toRow(room: RoomRecord, aggregate: ForecastAggregate | null, fin: FinalizationRecord | null, snap: MarketSnapshot | null, nowMs: number, window: ForecastWindow | null = null): StudioRoomRow {
  const m = snap?.market ?? null;
  // The window's lifecycle is the most advanced phase any source reported, so it wins over the snapshot's.
  const lifecycle = window?.lifecycle ?? (m ? marketLifecycle(m, Math.floor(nowMs / 1000)) : null);
  const c = aggregate ? consensusFrom(aggregate) : null;
  return {
    roomId: room.roomId,
    slug: room.slug,
    title: room.title,
    description: room.description,
    marketId: room.marketId,
    marketTitle: m && (m.title || "").trim() ? m.title.trim().slice(0, 200) : null,
    lifecycle,
    lifecycleLabel: lifecycle ? LIFECYCLE_LABEL[lifecycle] : "Market status unavailable",
    visibility: room.visibility,
    status: room.status,
    createdAt: new Date(room.createdAt).toISOString(),
    updatedAt: new Date(room.updatedAt).toISOString(),
    participants: c?.participants ?? 0,
    communityMeanBps: c?.kind === "consensus" ? c.meanBps : null,
    forecasting: forecastingState(room, fin, window),
    forecastingMessage: room.status === "archived" || fin || !window || window.open ? null : window.message,
    finalization: fin?.status ?? null,
    roomPath: roomPath(room.slug),
  };
}

const snap = (deps: StudioDeps, marketId: string) =>
  (deps.snapshot ?? ((id: string) => getMarketSnapshot(id, { waitMs: SNAPSHOT_WAIT_MS })))(marketId).catch(() => null);

/** Archived rooms aren't checked (badge says Archived). Failure or timeout → null → paused. */
async function windowFor(deps: StudioDeps, room: RoomRecord, nowMs: number): Promise<ForecastWindow | null> {
  if (!deps.window || room.status !== "active") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      deps.window(room.marketId, nowMs),
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), WINDOW_WAIT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ overview

export async function getStudioOverview(deps: StudioDeps, wallet: string): Promise<StudioOverview> {
  const now = deps.now();
  const days = recentDays(now, STUDIO_WINDOW_DAYS);
  const sinceMs = Date.parse(`${days[0]}T00:00:00.000Z`);
  const { rooms, truncated } = await loadCreatorRooms(deps.repo, wallet);
  const [facts, stats, dist] = await Promise.all([
    roomFacts(deps.repo, rooms),
    deps.repo.getCreatorStats(wallet, { rooms, sinceMs, maxFirst: MAX_FIRST_TIMES }),
    distributionFor(deps, wallet, days),
  ]);

  let currentForecasts = 0;
  let scored = 0;
  let pending = 0;
  let blocked = 0;
  let finalizedRooms = 0;
  let challenges = 0;
  for (const f of facts) {
    const n = f.aggregate.participants;
    currentForecasts += n;
    challenges += f.challenges;
    if (f.finalization?.status === "scored") {
      scored += f.scored;
      finalizedRooms += 1;
    } else if (f.finalization?.status === "blocked") {
      blocked += n;
      finalizedRooms += 1;
    } else pending += n;
  }
  const revisions = Object.entries(stats.revisionsByRoom)
    .filter(([id]) => rooms.some((r) => r.roomId === id))
    .reduce((s, [, n]) => s + n, 0);

  const newByDay = new Map(days.map((d) => [d, 0]));
  for (const t of stats.firstForecastTimes) {
    const d = utcDay(t);
    if (newByDay.has(d)) newByDay.set(d, newByDay.get(d)! + 1);
  }

  const distribution: Tracked<DistributionTotals> = dist.error
    ? { tracked: false, reason: "Distribution counters couldn't be read right now (storage error). Participation numbers above are unaffected." }
    : summarizeDistribution(dist.rows, days);

  const perRoomCounter = (roomId: string, metric: string) => dist.rows.filter((r) => r.roomId === roomId && r.metric === metric).reduce((s, r) => s + r.count, 0);
  const activityByRoom = facts.map((f) => ({
    roomId: f.room.roomId,
    slug: f.room.slug,
    title: f.room.title,
    currentForecasts: f.aggregate.participants,
    revisions: stats.revisionsByRoom[f.room.roomId] ?? 0,
    views: distribution.tracked ? perRoomCounter(f.room.roomId, METRIC.view) : null,
    embedRequests: distribution.tracked ? perRoomCounter(f.room.roomId, METRIC.embed) : null,
  }));

  const active = rooms.filter((r) => r.status === "active");
  const top = [...activityByRoom].sort((a, b) => b.currentForecasts - a.currentForecasts)[0] ?? null;
  const roomsSummary = {
    total: rooms.length,
    active: active.length,
    archived: rooms.length - active.length,
    public: rooms.filter((r) => r.visibility === "public").length,
    unlisted: rooms.filter((r) => r.visibility === "unlisted").length,
    truncated,
  };
  return {
    schemaVersion: STUDIO_SCHEMA_VERSION,
    wallet,
    generatedAt: new Date(now).toISOString(),
    rooms: roomsSummary,
    participation: {
      uniqueForecasters: stats.uniqueForecasters,
      returningForecasters: stats.returningForecasters,
      currentForecasts,
      revisions,
      scoredForecasts: scored,
      pendingForecasts: pending,
      unscoredBlocked: blocked,
      finalizedRooms,
      challenges,
      newForecastersByDay: [...newByDay.entries()].map(([day, count]) => ({ day, count })),
      approximate: stats.approximate,
    },
    distribution,
    activityByRoom,
    insights: buildInsights({
      rooms: roomsSummary,
      uniqueForecasters: stats.uniqueForecasters,
      returningForecasters: stats.returningForecasters,
      currentForecasts,
      revisions,
      pendingForecasts: pending,
      scoredForecasts: scored,
      activeRoomsWithoutForecasts: facts.filter((f) => f.room.status === "active" && f.aggregate.participants === 0).length,
      topRoom: top ? { title: top.title, currentForecasts: top.currentForecasts } : null,
      distribution,
    }),
  };
}

// ------------------------------------------------------------------ rooms list

export const STUDIO_STATUS_FILTERS = ["all", "active", "archived", "public", "unlisted"] as const;
export type StudioStatusFilter = (typeof STUDIO_STATUS_FILTERS)[number];

export async function listStudioRooms(deps: StudioDeps, wallet: string, opts: { q: string; status: StudioStatusFilter; page: number }): Promise<StudioRoomsPage> {
  const { rooms, truncated } = await loadCreatorRooms(deps.repo, wallet);
  const q = opts.q.trim().toLowerCase();
  const filtered = rooms.filter((r) => {
    if (opts.status === "active" && r.status !== "active") return false;
    if (opts.status === "archived" && r.status !== "archived") return false;
    if (opts.status === "public" && r.visibility !== "public") return false;
    if (opts.status === "unlisted" && r.visibility !== "unlisted") return false;
    return !q || r.title.toLowerCase().includes(q) || r.slug.includes(q) || r.description.toLowerCase().includes(q);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / STUDIO_PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page), pages);
  const slice = filtered.slice((page - 1) * STUDIO_PAGE_SIZE, page * STUDIO_PAGE_SIZE);
  const now = deps.now();
  const items = await mapLimit(slice, CONCURRENCY, async (room) => {
    const [aggregate, fin, s, w] = await Promise.all([
      deps.repo.getForecastAggregate(room.roomId).catch(() => null),
      deps.repo.getFinalization(room.marketId).catch(() => null),
      snap(deps, room.marketId),
      windowFor(deps, room, now),
    ]);
    return toRow(room, aggregate, fin, s, now, w);
  });
  return { items, total: filtered.length, page, pageSize: STUDIO_PAGE_SIZE, pages, truncated };
}

// ------------------------------------------------------------------ one room

/** null when the room doesn't exist OR isn't owned by `wallet` (callers answer one identical 404). */
export async function getStudioRoom(deps: StudioDeps, wallet: string, slug: string): Promise<StudioRoomAnalytics | null> {
  const room = await deps.repo.getRoomBySlug(slug);
  if (!room || room.creatorWallet !== wallet) return null;
  const now = deps.now();
  const days = recentDays(now, STUDIO_WINDOW_DAYS);
  const { rooms } = await loadCreatorRooms(deps.repo, wallet);
  const [[facts], stats, s, dist, latestDebate, w] = await Promise.all([
    roomFacts(deps.repo, [room]),
    deps.repo.getCreatorStats(wallet, { rooms, sinceMs: now, maxFirst: 1 }),
    snap(deps, room.marketId),
    distributionFor(deps, wallet, days),
    deps.repo.getLatestDebate(room.roomId).catch(() => null),
    windowFor(deps, room, now),
  ]);
  const c = consensusFrom(facts.aggregate);
  const roomUrl = `${deps.origin}${roomPath(room.slug)}`;
  const n = facts.aggregate.participants;
  const distribution: Tracked<DistributionTotals> = dist.error
    ? { tracked: false, reason: "Distribution counters couldn't be read right now (storage error)." }
    : summarizeDistribution(dist.rows, days, room.roomId);
  const active = room.status === "active";
  const revisions = stats.revisionsByRoom[room.roomId] ?? 0;
  return {
    schemaVersion: STUDIO_SCHEMA_VERSION,
    room: toRow(room, facts.aggregate, facts.finalization, s, now, w),
    participation: {
      currentForecasts: n,
      revisions,
      scored: facts.scored,
      pending: facts.finalization ? 0 : n,
      challenges: facts.challenges,
      distribution: c.buckets,
      meanBps: c.kind === "consensus" ? c.meanBps : null,
    },
    distribution,
    links: {
      roomUrl,
      embedUrl: active ? embedUrl(deps.origin, room.slug, DEFAULT_EMBED_OPTIONS) : null,
      leaderboardUrl: `${roomUrl}#leaderboard`,
      arenaUrl: `${deps.origin}/arena`,
      creatorProfileUrl: `${deps.origin}/forecasters/${encodeURIComponent(wallet)}`,
      debateUrl: active && latestDebate ? `${roomUrl}#debate` : null,
    },
    insights: buildInsights({
      rooms: { total: 1, active: active ? 1 : 0, archived: active ? 0 : 1 },
      uniqueForecasters: n,
      returningForecasters: 0,
      currentForecasts: n,
      revisions,
      pendingForecasts: facts.finalization ? 0 : n,
      scoredForecasts: facts.scored,
      activeRoomsWithoutForecasts: active && n === 0 ? 1 : 0,
      topRoom: null,
      distribution,
    }).filter((i) => i.id !== "returning"),
  };
}
