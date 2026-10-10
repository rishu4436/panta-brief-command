import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { appOrigin } from "@/lib/embed/origin";
import { currentSession, limitRequest, reject } from "@/lib/rooms/http";
import { roomRepository } from "@/lib/rooms/store";
import type { MarketSnapshot } from "@/lib/embed/market-snapshot";
import type { StudioDeps } from "./service";

let snapshotOverride: ((marketId: string) => Promise<MarketSnapshot>) | undefined;

/** Tests only: replace the (cached) Panta market snapshot source. */
export function __setStudioSnapshotForTests(fn: ((marketId: string) => Promise<MarketSnapshot>) | undefined) {
  snapshotOverride = fn;
}

export function studioDeps(): StudioDeps {
  return { repo: roomRepository(), now: Date.now, origin: appOrigin(), snapshot: snapshotOverride };
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
