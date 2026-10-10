import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/embed/origin";
import { currentSession, limitRequest, reject } from "@/lib/rooms/http";
import { roomRepository } from "@/lib/rooms/store";
import type { MarketSnapshot } from "@/lib/embed/market-snapshot";
import { forecastDeps } from "@/lib/forecasts/deps";
import type { ForecastWindow } from "@/lib/forecasts/window";
import type { StudioDeps } from "./service";

let snapshotOverride: ((marketId: string) => Promise<MarketSnapshot>) | undefined;

/** Tests only: replace the (cached) Panta market snapshot source. */
export function __setStudioSnapshotForTests(fn: ((marketId: string) => Promise<MarketSnapshot>) | undefined) {
  snapshotOverride = fn;
}

let windowOverride: ((marketId: string, nowMs: number) => Promise<ForecastWindow>) | undefined;

/** Tests only: replace the forecast window check Studio shares with the room panel. */
export function __setStudioWindowForTests(fn: ((marketId: string, nowMs: number) => Promise<ForecastWindow>) | undefined) {
  windowOverride = fn;
}

export function studioDeps(): StudioDeps {
  // Same read-path window the room's GET /forecasts returns (forecastDeps().readWindow).
  return { repo: roomRepository(), now: Date.now, origin: appOrigin(), snapshot: snapshotOverride, window: windowOverride ?? forecastDeps().readWindow };
}

/**
 * Every /api/studio route: rate limit, then the verified session wallet
 * (signed cookie). No wallet is ever taken from the query or body.
 */
export async function studioAuth(req: NextRequest): Promise<{ ok: true; wallet: string } | { ok: false; res: NextResponse }> {
  const limited = await limitRequest(req, "studioRead");
  if (limited) return { ok: false, res: limited };
  const session = currentSession(req);
  if (!session) return { ok: false, res: reject(401, "WALLET_NOT_VERIFIED", "Sign in with your wallet to open Creator Studio.") };
  return { ok: true, wallet: session.wallet };
}
