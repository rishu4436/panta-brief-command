import "server-only";

/** Fresh resolution evidence for finalization (no caches anywhere). */

import { readEventAccount } from "@/lib/panta/chain-event-server";
import { fetchMarketWithRetry } from "@/lib/panta/markets";
import { pantaServerGet, UpstreamError } from "@/lib/panta/server";
import type { DetailEvidenceRead } from "./evidence";
import type { ChainEventRead } from "@/lib/panta/chain-event-server";

const DETAIL_TIMEOUT_MS = 8_000;
const CHAIN_TIMEOUT_MS = 5_000;

export type ResolutionEvidence = { detail: DetailEvidenceRead; chain: ChainEventRead };

export async function gatherResolutionEvidence(marketId: string): Promise<ResolutionEvidence> {
  const detailP = (async (): Promise<DetailEvidenceRead> => {
    const fetchedAt = Date.now();
    try {
      const detail = await fetchMarketWithRetry(() => pantaServerGet(`/markets/${encodeURIComponent(marketId)}/`, DETAIL_TIMEOUT_MS), [400, 900]);
      return { status: detail ? "ok" : "failed", detail, fetchedAt };
    } catch (e) {
      const status = e instanceof UpstreamError && e.status === 404 ? "not_found" : "failed";
      return { status, detail: null, fetchedAt, error: e instanceof UpstreamError ? e.code : "unreachable" };
    }
  })();
  const [detail, chain] = await Promise.all([detailP, readEventAccount(marketId, CHAIN_TIMEOUT_MS)]);
  return { detail, chain };
}
