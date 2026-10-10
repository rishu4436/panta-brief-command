import { NextRequest } from "next/server";
import { buildEmbedModel } from "@/lib/embed/model";
import { renderEmbed, renderEmbedMessage } from "@/lib/embed/html";
import { getMarketSnapshot, getUncachedMarketSnapshot, type SnapshotSources } from "@/lib/embed/market-snapshot";
import { parseEmbedOptions, type EmbedOptions } from "@/lib/embed/options";
import { appOrigin } from "@/lib/embed/origin";
import { EMBED_RATE_LIMIT_PER_MIN, embedHtml, embedNotFound } from "@/lib/embed/respond";
import { clientIp } from "@/lib/rate-limit";
import { slugProblem } from "@/lib/rooms/domain";
import { roomRepository } from "@/lib/rooms/store";
import { limitShared } from "@/lib/shared-store";
import { forecastDeps } from "@/lib/forecasts/deps";
import type { ForecastWindow } from "@/lib/forecasts/window";
import { recordEmbedRequest, runAfterResponse, skipReason } from "@/lib/studio/events";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Development-only: `_dev_market=unavailable` renders the widget as if Panta
 * and the chain were unreachable (for the local preview page). The branch
 * is removed from production builds (NODE_ENV is inlined) and ignored in tests.
 */
function devSources(req: NextRequest): SnapshotSources | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  if (req.nextUrl.searchParams.get("_dev_market") !== "unavailable") return undefined;
  return {
    readChain: async () => ({ status: "failed", error: "simulated (dev only)", fetchedAt: Date.now() }),
    readDetail: async () => ({ status: "failed", detail: null }),
    catalogRow: () => null,
  };
}

/**
 * Time budget for the shared forecast window in the widget. It runs in
 * parallel with the snapshot read and is usually served from the 15 s read
 * cache; a slower or failed check renders "Forecasting paused", never open.
 */
const EMBED_WINDOW_WAIT_MS = 1_200;

async function embedWindow(marketId: string, nowMs: number): Promise<ForecastWindow | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      forecastDeps().readWindow(marketId, nowMs),
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), EMBED_WINDOW_WAIT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(o: EmbedOptions, home: string) {
  return embedHtml(renderEmbedMessage(o, home, "Temporarily unavailable", "Room data couldn't be loaded right now. Try again shortly."), 503, "no-store");
}

/**
 * GET /embed/rooms/:slug?theme&layout&dist&market — public, read-only,
 * frameable widget for a room. Same visibility as /rooms/:slug (active rooms,
 * public or unlisted, are viewable by link); missing, archived and malformed
 * slugs get one identical 404. Never reads cookies or the session, never
 * fetches resolution evidence or finalizes anything. The only write is the
 * Creator Studio's approximate embed-request counter (after the response;
 * see docs/CREATOR_STUDIO.md).
 */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const o = parseEmbedOptions(req.nextUrl.searchParams);
  const origin = appOrigin();
  const rl = await limitShared(`embed:${clientIp(req.headers)}`, EMBED_RATE_LIMIT_PER_MIN, 60_000);
  if (!rl.ok) {
    const res = embedHtml(renderEmbedMessage(o, origin, "Too many requests", "Please wait a minute and reload."), 429, "no-store");
    res.headers.set("Retry-After", String(rl.retryAfterSec));
    return res;
  }
  let slug: string;
  try {
    slug = decodeURIComponent((await ctx.params).slug || "").toLowerCase();
  } catch {
    return embedNotFound(o, origin);
  }
  if (slugProblem(slug)) return embedNotFound(o, origin);
  try {
    const repo = roomRepository();
    const room = await repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return embedNotFound(o, origin);
    const dev = devSources(req);
    const now = Date.now();
    const [aggregate, finalization, snapshot, window] = await Promise.all([
      repo.getForecastAggregate(room.roomId),
      repo.getFinalization(room.marketId),
      dev ? getUncachedMarketSnapshot(room.marketId, dev) : getMarketSnapshot(room.marketId),
      dev ? Promise.resolve(null) : embedWindow(room.marketId, now),
    ]);
    const model = buildEmbedModel({ room, origin, aggregate, finalization, snapshot, nowMs: Date.now(), window });
    // Creator Studio: approximate embed request count, after the response (no script in the widget,
    // CSP unchanged). Bots, prefetches and DNT/GPC are skipped before any storage call.
    // Same-origin loads are the creator's own previews (Studio / embed generator): not counted.
    if (!skipReason(req.headers) && req.headers.get("sec-fetch-site") !== "same-origin") runAfterResponse(() => recordEmbedRequest(repo, room, req.headers, Date.now()));
    return embedHtml(renderEmbed(model, o));
  } catch {
    return unavailable(o, origin);
  }
}
