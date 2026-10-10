/**
 * Creator Growth Studio: shared (client-safe) definitions. See docs/CREATOR_STUDIO.md.
 *
 * Two kinds of numbers live in the Studio and the UI must never blur them:
 *  - PARTICIPATION: derived from durable records (rooms, forecasts, revisions,
 *    scores, debate challenges). Exact, wallet-based, available for all history.
 *  - DISTRIBUTION: first-party, privacy-conscious counters recorded from Phase 6
 *    on (no history before that). Approximate by design: bots are filtered by
 *    heuristics, repeats are deduplicated per day, embed requests behind a CDN
 *    are undercounted. Never tied to a wallet; no cookies; no raw IPs.
 */

import { z } from "zod";

export const STUDIO_SCHEMA_VERSION = 1 as const;
export const STUDIO_EVENT_SCHEMA_VERSION = 1 as const;

/** Rooms a creator can manage in the Studio (newest first). Documented scaling limit. */
export const MAX_STUDIO_ROOMS = 200;
export const STUDIO_PAGE_SIZE = 10;
/** Distribution counters are kept this many UTC days. */
export const ANALYTICS_RETENTION_DAYS = 90;
/** Charts/insights read at most this many recent UTC days. */
export const STUDIO_WINDOW_DAYS = 30;
/** Distinct counter fields per creator per UTC day (all rooms together). */
export const MAX_DAY_FIELDS = 2000;
/** Distinct dynamic fields (campaign ids, referrer hosts) per room per UTC day; the rest fold into "other". */
export const MAX_DYNAMIC_FIELDS_PER_ROOM_DAY = 25;
/** Repeat events from the same (ip, user agent, room, event) count once per UTC day. */
export const DEDUPE_TTL_MS = 26 * 3600_000;

/** Campaign ids in `?c=<id>` links. */
export const CAMPAIGN_ID_RE = /^[a-z0-9-]{1,32}$/;
/** Lower-case host names only (no port, no path); bounded length. */
export const REFERRER_HOST_RE = /^(?=.{1,100}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;

export const ROOM_EVENT_TYPES = ["room_view"] as const;

/** Body of POST /api/rooms/:slug/events (sent with navigator.sendBeacon). */
export const RoomEventInput = z.strictObject({
  schemaVersion: z.literal(STUDIO_EVENT_SCHEMA_VERSION),
  event: z.enum(ROOM_EVENT_TYPES),
  /** Only "embed" is accepted (set by the embed widget's link). */
  ref: z.literal("embed").nullable().optional(),
  campaign: z.string().regex(CAMPAIGN_ID_RE).nullable().optional(),
  /** document.referrer's host name only, never a URL; re-validated server-side. */
  referrerHost: z.string().max(253).nullable().optional(),
});
export type RoomEventInput = z.infer<typeof RoomEventInput>;

/**
 * Counter metric names (fields are `<roomId>|<metric>`):
 *  view            observed room page views (client beacon, daily-deduplicated)
 *  embed           server requests to /embed/rooms/:slug (approximate)
 *  cta             room views arriving with ?ref=embed (embed link click-throughs)
 *  src:direct | src:embed | src:same-site | src:other | src:h:<host>
 *  c:<campaignId> | c:other
 */
export const METRIC = {
  view: "view",
  embed: "embed",
  cta: "cta",
  srcDirect: "src:direct",
  srcEmbed: "src:embed",
  srcSameSite: "src:same-site",
  srcOther: "src:other",
  campaignOther: "c:other",
} as const;
export const srcHostMetric = (host: string) => `src:h:${host}`;
export const campaignMetric = (id: string) => `c:${id}`;
export const isDynamicMetric = (m: string) => m.startsWith("src:h:") || (m.startsWith("c:") && m !== METRIC.campaignOther);

export type SourceBucket = "direct" | "embed" | "same-site" | { host: string } | "other";

/** `YYYY-MM-DD` (UTC) for a millisecond timestamp. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The last `n` UTC days ending with `nowMs`'s day, oldest first. */
export function recentDays(nowMs: number, n: number): string[] {
  const out: string[] = [];
  const today = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  for (let i = n - 1; i >= 0; i--) out.push(utcDay(today - i * 86_400_000));
  return out;
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// API shapes (GET /api/studio/*)

/** A distribution number is either measured or explicitly not tracked; never a fake 0. */
export type Tracked<T> = { tracked: true; value: T } | { tracked: false; reason: string };

export type DistributionTotals = {
  /** First UTC day with any counter for this creator in the window, or null. */
  since: string | null;
  views: number;
  embedRequests: number;
  ctaClicks: number;
  sources: { key: string; label: string; count: number }[];
  campaigns: { id: string; count: number }[];
  byDay: { day: string; views: number; embedRequests: number; ctaClicks: number }[];
};

export type StudioOverview = {
  schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  wallet: string;
  generatedAt: string;
  rooms: { total: number; active: number; archived: number; public: number; unlisted: number; truncated: boolean };
  participation: {
    uniqueForecasters: number;
    returningForecasters: number;
    currentForecasts: number;
    revisions: number;
    scoredForecasts: number;
    pendingForecasts: number;
    /** Forecasts in rooms whose market finalization was blocked (never scored). */
    unscoredBlocked: number;
    finalizedRooms: number;
    challenges: number;
    newForecastersByDay: { day: string; count: number }[];
    /** Redis: maintained indexes were rebuilt from a capped scan (see docs). */
    approximate: boolean;
  };
  distribution: Tracked<DistributionTotals>;
  activityByRoom: { roomId: string; slug: string; title: string; currentForecasts: number; revisions: number; views: number | null; embedRequests: number | null }[];
  insights: Insight[];
};

export type StudioRoomRow = {
  roomId: string;
  slug: string;
  title: string;
  description: string;
  marketId: string;
  marketTitle: string | null;
  lifecycle: string | null;
  lifecycleLabel: string;
  visibility: "public" | "unlisted";
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  participants: number;
  communityMeanBps: number | null;
  forecasting: "open" | "closed" | "archived" | "unknown";
  finalization: "scored" | "blocked" | null;
  roomPath: string;
};

export type StudioRoomsPage = {
  items: StudioRoomRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  truncated: boolean;
};

export type StudioRoomAnalytics = {
  schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  room: StudioRoomRow;
  participation: {
    currentForecasts: number;
    revisions: number;
    scored: number;
    pending: number;
    challenges: number;
    distribution: number[];
    meanBps: number | null;
  };
  distribution: Tracked<DistributionTotals>;
  links: {
    roomUrl: string;
    embedUrl: string | null;
    leaderboardUrl: string;
    arenaUrl: string;
    creatorProfileUrl: string;
    debateUrl: string | null;
  };
  insights: Insight[];
};

export type Insight = { id: string; tone: "info" | "positive" | "attention"; title: string; detail: string; basis: string };

// ---------------------------------------------------------------------------
// Labels & definitions shown in the UI (one place so the docs and UI agree)

export const NOT_TRACKED = "Not tracked yet";

export const DEFINITIONS = {
  uniqueForecasters: "Distinct wallets with a current forecast in at least one of your rooms. A wallet is not necessarily one person.",
  returningForecasters: "Wallets that forecast in two or more different rooms of yours. Editing a forecast in the same room does not count.",
  currentForecasts: "One per wallet per room: the latest version of each forecast.",
  revisions: "Every saved version of every forecast, including the first.",
  scored: "Forecasts scored after their market resolved and was finalized.",
  pending: "Current forecasts in rooms whose market has not been finalized yet.",
  challenges: "AI debate challenges on the debates still kept for your rooms (latest 5 per room).",
  views: "Room page views observed by a same-origin beacon, bots filtered, repeats from the same browser counted once per room per UTC day.",
  embedRequests: "Server requests for your embed widget. Approximate: CDN caching (30 s) hides repeat loads in production, so this undercounts.",
  ctaClicks: "Room page views that arrived from an embed widget link (?ref=embed).",
  campaigns: "Room page views that arrived with a campaign link (?c=<id>).",
  newForecasters: "Wallets whose first forecast in any of your rooms happened that UTC day.",
} as const;

export function sourceLabel(key: string): string {
  if (key === METRIC.srcDirect) return "Direct / unknown";
  if (key === METRIC.srcEmbed) return "Embed widget link";
  if (key === METRIC.srcSameSite) return "Elsewhere on Brief Command";
  if (key === METRIC.srcOther) return "Other sites (capped)";
  if (key.startsWith("src:h:")) return key.slice(6);
  return key;
}

/** Campaign link for a room: canonical room URL + validated `c` param. Returns null for invalid ids. */
export function campaignUrl(roomUrl: string, id: string): string | null {
  if (!CAMPAIGN_ID_RE.test(id)) return null;
  return `${roomUrl}?c=${id}`;
}
