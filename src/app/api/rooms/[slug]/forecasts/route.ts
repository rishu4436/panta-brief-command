import { NextRequest } from "next/server";
import { CLIENT_IDENTITY_KEYS, LIST_LIMIT_MAX, LIST_OFFSET_MAX, SubmitForecastInput } from "@/lib/forecasts/domain";
import { forecastDeps } from "@/lib/forecasts/deps";
import { roomForecastSummary, submitForecast } from "@/lib/forecasts/service";
import { publicWindow } from "@/lib/forecasts/window-public";
import { slugProblem } from "@/lib/rooms/domain";
import {
  FORECAST_WALLET_LIMIT,
  errorResponse,
  limitRequest,
  ok,
  readJson,
  reject,
  sameOriginOrReject,
  requireSession,
} from "@/lib/rooms/http";
import { limitShared } from "@/lib/shared-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const FORECAST_BODY_MAX_BYTES = 8 * 1024;

async function slugFrom(ctx: Ctx): Promise<string | null> {
  const { slug } = await ctx.params;
  const s = (slug || "").toLowerCase();
  return slugProblem(s) === null ? s : null;
}

function intParam(v: string | null, fallback: number, min: number, max: number): number {
  if (v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * GET /api/rooms/:slug/forecasts[?limit&offset] — public. Community forecast
 * (mean of current forecasts, participants, histogram), one bounded page of
 * current forecasts, and whether forecasting is open (with the cutoff).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = await limitRequest(req, "read");
  if (limited) return limited;
  const slug = await slugFrom(ctx);
  if (!slug) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  const sp = req.nextUrl.searchParams;
  const limit = intParam(sp.get("limit"), 20, 1, LIST_LIMIT_MAX);
  const offset = intParam(sp.get("offset"), 0, 0, LIST_OFFSET_MAX);
  const deps = forecastDeps();
  try {
    const room = await deps.repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    const [summary, window] = await Promise.all([roomForecastSummary(deps.repo, room.roomId, { limit, offset }), deps.readWindow(room.marketId, deps.now())]);
    return ok({ roomId: room.roomId, marketId: room.marketId, window: publicWindow(window), ...summary });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/rooms/:slug/forecasts {roomId, probabilityBps, reasoning?, expectedRevision, idempotencyKey}
 * Forecaster = the verified wallet in the HttpOnly session. A body that names
 * a wallet is rejected. Writes only while Panta confirms the forecast window
 * is open (fresh server-side check).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const cross = sameOriginOrReject(req);
  if (cross) return cross;
  const auth = await requireSession(req, { message: "Verify your wallet before forecasting." });
  if (!auth.ok) return auth.res;
  const session = auth.session;
  const slug = await slugFrom(ctx);
  if (!slug) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  const read = await readJson(req, "forecast", FORECAST_BODY_MAX_BYTES);
  if (!read.ok) return read.res;
  const walletRl = await limitShared(`rooms-forecast-wallet:${session.wallet}`, FORECAST_WALLET_LIMIT, 60_000);
  if (!walletRl.ok) return reject(429, "RATE_LIMITED", "Too many forecast updates. Wait a minute.", { "Retry-After": String(walletRl.retryAfterSec) });

  const body = read.body;
  if (body && typeof body === "object" && CLIENT_IDENTITY_KEYS.some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
    return reject(400, "CLIENT_WALLET_REJECTED", "The forecasting wallet comes from your verified sign-in, not the request.");
  }
  const parsed = SubmitForecastInput.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.[0];
    return reject(400, "INVALID_FORECAST", `${field ? `${String(field)}: ` : ""}${issue?.message ?? "Invalid forecast."}`.slice(0, 200));
  }
  const deps = forecastDeps();
  try {
    const room = await deps.repo.getRoomBySlug(slug);
    if (!room || room.status !== "active") return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
    const res = await submitForecast(deps, session.wallet, room, parsed.data);
    return ok(res, res.status === "created" ? 201 : 200);
  } catch (e) {
    return errorResponse(e);
  }
}
