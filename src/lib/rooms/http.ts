import "server-only";

/** Shared request/response helpers for the /api/rooms route handlers. */

import { NextRequest, NextResponse } from "next/server";
import { readLimitedJson, reject } from "@/lib/evidence/http";
import { clientIp } from "@/lib/rate-limit";
import { limitShared } from "@/lib/shared-store";
import { readSession, sessionSecret, SESSION_COOKIE, RoomAuthError, type RoomSession } from "./auth";
import { MarketRejectedError } from "./service";
import { ForecastRoomMismatchError, ForecastingClosedError } from "@/lib/forecasts/service";
import {
  CreateInProgressError,
  ForecastRevisionConflictError,
  IdempotencyConflictError,
  RoomForbiddenError,
  RoomNotFoundError,
  RoomStoreUnavailableError,
  SlugTakenError,
} from "./store/types";
import { UNCONFIGURED_MESSAGE } from "./store";

export const ROOM_BODY_MAX_BYTES = 4 * 1024;
export const AUTH_BODY_MAX_BYTES = 1024;

/** Per-minute limits per client IP (shared across instances when Redis is configured). */
export const ROOM_LIMITS = {
  challenge: 10,
  verify: 10,
  create: 6,
  update: 10,
  slugCheck: 40,
  read: 120,
  forecast: 20,
} as const;

/** Per verified wallet, per minute (on top of the per-IP forecast limit). */
export const FORECAST_WALLET_LIMIT = 12;

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function ok(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export { reject };

export function readJson(req: NextRequest, bucket: keyof typeof ROOM_LIMITS, maxBytes = ROOM_BODY_MAX_BYTES) {
  return readLimitedJson(req, `rooms-${bucket}`, ROOM_LIMITS[bucket], maxBytes);
}

/** Rate limit for bodyless requests (GET). Returns a 429 response or null. */
export async function limitRequest(req: NextRequest, bucket: keyof typeof ROOM_LIMITS): Promise<NextResponse | null> {
  const rl = await limitShared(`rooms-${bucket}:${clientIp(req.headers)}`, ROOM_LIMITS[bucket], 60_000);
  return rl.ok ? null : reject(429, "RATE_LIMITED", undefined, { "Retry-After": String(rl.retryAfterSec) });
}

/** Host the request was addressed to (Vercel sets Host / x-forwarded-host itself). */
export function requestHost(req: NextRequest): string {
  return (req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host).split(",")[0].trim();
}

export function requestOrigin(req: NextRequest): string {
  const proto = (req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "")).split(",")[0].trim();
  return `${proto === "https" ? "https" : "http"}://${requestHost(req)}`;
}

/** Host from the Origin header, or null when absent / malformed. */
export function originHost(req: NextRequest): string | null {
  const o = req.headers.get("origin");
  if (!o) return null;
  try {
    return new URL(o).host;
  } catch {
    return null;
  }
}

/** CSRF guard for state-changing requests: Origin must be present and same-host. */
export function sameOriginOrReject(req: NextRequest): NextResponse | null {
  const host = originHost(req);
  if (!host || host !== requestHost(req)) return reject(403, "CROSS_ORIGIN_REJECTED", "Requests must come from this site.");
  return null;
}

export function currentSession(req: NextRequest, now = Date.now()): RoomSession | null {
  return readSession(req.cookies.get(SESSION_COOKIE)?.value, now, sessionSecret());
}

/** Map service/repository errors to safe HTTP answers (no internals leak). */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof RoomAuthError) return reject(e.status, e.code, e.message);
  if (e instanceof MarketRejectedError) {
    return reject(e.check.code === "MARKET_VALIDATION_UNAVAILABLE" ? 503 : 422, e.check.code, e.check.message);
  }
  if (e instanceof SlugTakenError) return reject(409, "SLUG_TAKEN", "That room address is already taken. Choose another.");
  if (e instanceof IdempotencyConflictError) {
    return reject(409, "IDEMPOTENCY_KEY_REUSED", "This request id was already used for a different request. Review and submit again.");
  }
  if (e instanceof CreateInProgressError) return reject(409, "CREATE_IN_PROGRESS", "This room is still being saved. Try again in a moment.");
  if (e instanceof RoomNotFoundError) return reject(404, "ROOM_NOT_FOUND", "No room at this address.");
  if (e instanceof ForecastingClosedError) {
    return e.window.reason === "unavailable"
      ? reject(503, "FORECAST_WINDOW_UNAVAILABLE", e.window.message)
      : reject(409, "FORECASTING_CLOSED", e.window.message);
  }
  if (e instanceof ForecastRevisionConflictError) {
    return NextResponse.json(
      {
        error: "FORECAST_REVISION_CONFLICT",
        code: "FORECAST_REVISION_CONFLICT",
        detail: "Your forecast changed somewhere else (another tab or device). Reload it, then edit again.",
        currentRevision: e.currentRevision,
      },
      { status: 409, headers: NO_STORE },
    );
  }
  if (e instanceof ForecastRoomMismatchError) return reject(400, "ROOM_MISMATCH", "This forecast names a different room. Reload the page.");
  if (e instanceof RoomForbiddenError) return reject(403, "NOT_ROOM_CREATOR", "Only the wallet that created this room can change it.");
  if (e instanceof RoomStoreUnavailableError) {
    return e.reason === "unconfigured"
      ? reject(503, "ROOMS_STORE_UNCONFIGURED", UNCONFIGURED_MESSAGE)
      : reject(503, "ROOMS_STORE_UNAVAILABLE", "Room storage didn't respond. Nothing was changed. Try again.");
  }
  console.error("[rooms] unexpected error", e instanceof Error ? e.name : typeof e);
  return reject(500, "ROOMS_INTERNAL_ERROR", "Something went wrong. Nothing was changed.");
}
