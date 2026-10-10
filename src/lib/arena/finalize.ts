import "server-only";

/**
 * Arena finalization service: the ONLY place scores are created.
 *
 * Triggered explicitly (POST /api/arena/finalize with the server-only admin
 * token, or `npm run arena:finalize` which calls that endpoint). Never run by
 * page loads, never polled in a loop.
 *
 *  1. A market that already has a finalization is returned as-is (idempotent:
 *     no new evidence fetch, no rescoring).
 *  2. Fresh evidence from Panta's market record AND the on-chain Event
 *     account (evidence.ts). Not resolved / missing evidence / cancelled →
 *     nothing written. Conflicting outcomes → a persisted "blocked"
 *     finalization (needs reconciliation) with no scores.
 *  3. Resolved: snapshot every room on the market, score each forecaster's
 *     final pre-cutoff revision, pick the global score per wallet, and commit
 *     everything in one atomic repository step (a concurrent run gets
 *     "exists").
 */

import type { RoomRepository } from "@/lib/rooms/store/types";
import { decideResolution, type ResolutionDecision, type ResolutionProvenance } from "./evidence";
import type { ResolutionEvidence } from "./evidence-server";
import { computeMarketScores } from "./scoring";
import type { FinalizationRecord } from "./types";

export type FinalizeDeps = {
  repo: RoomRepository;
  gatherEvidence: (marketId: string) => Promise<ResolutionEvidence>;
  now: () => number;
};

export type FinalizeReport = {
  marketId: string;
  result: "scored" | "blocked" | "already_finalized" | "not_resolved" | "missing_evidence" | "cancelled" | "no_rooms";
  message: string;
  finalization?: FinalizationRecord;
  provenance?: ResolutionProvenance;
  roomsScored?: number;
  scoresWritten?: number;
  globalScoresWritten?: number;
};

const MESSAGES: Record<FinalizeReport["result"], string> = {
  scored: "Verified resolution: scores written.",
  blocked: "Panta and the on-chain record disagree on the outcome. Finalization is BLOCKED (needs reconciliation); no scores written.",
  already_finalized: "This market was already finalized; nothing was rescored.",
  not_resolved: "Not resolved yet: no scores written.",
  missing_evidence: "Resolution evidence is incomplete: no scores written. Retry later.",
  cancelled: "Market cancelled: nothing is scored.",
  no_rooms: "No prediction room uses this market.",
};

export async function finalizeMarket(deps: FinalizeDeps, marketId: string): Promise<FinalizeReport> {
  const existing = await deps.repo.getFinalization(marketId);
  if (existing) return { marketId, result: "already_finalized", message: MESSAGES.already_finalized, finalization: existing };

  const snapshotBefore = await deps.repo.getMarketForecastSnapshot(marketId);
  if (!snapshotBefore.rooms.length) return { marketId, result: "no_rooms", message: MESSAGES.no_rooms };

  const evidence = await deps.gatherEvidence(marketId);
  const decision: ResolutionDecision = decideResolution(marketId, evidence.detail, evidence.chain, deps.now());
  if (decision.kind === "not_resolved" || decision.kind === "cancelled") return { marketId, result: decision.kind, message: MESSAGES[decision.kind], provenance: decision.provenance };
  if (decision.kind === "missing_evidence") return { marketId, result: "missing_evidence", message: `${MESSAGES.missing_evidence} (${decision.reason})`, provenance: decision.provenance };

  const finalizedAt = deps.now();
  if (decision.kind === "blocked") {
    const finalization: FinalizationRecord = {
      marketId,
      status: "blocked",
      outcome: null,
      cutoffAt: null,
      finalizedAt,
      provenance: decision.provenance,
      roomsScored: 0,
      scoresWritten: 0,
      globalScoresWritten: 0,
    };
    const res = await deps.repo.commitFinalization({ finalization, roomScores: [], globalScores: [] });
    return res.status === "exists"
      ? { marketId, result: "already_finalized", message: MESSAGES.already_finalized, finalization: res.finalization }
      : { marketId, result: "blocked", message: MESSAGES.blocked, finalization, provenance: decision.provenance };
  }

  // Re-read after the evidence fetch so every revision stored up to now is included
  // (writes after the cutoff are impossible; the scorer re-checks timestamps anyway).
  const snapshot = await deps.repo.getMarketForecastSnapshot(marketId);
  const { roomScores, globalScores } = computeMarketScores(snapshot, decision.outcome, decision.cutoffAt, finalizedAt);
  const finalization: FinalizationRecord = {
    marketId,
    status: "scored",
    outcome: decision.outcome,
    cutoffAt: decision.cutoffAt,
    finalizedAt,
    provenance: decision.provenance,
    roomsScored: new Set(roomScores.map((s) => s.roomId)).size,
    scoresWritten: roomScores.length,
    globalScoresWritten: globalScores.length,
  };
  const res = await deps.repo.commitFinalization({ finalization, roomScores, globalScores });
  if (res.status === "exists") return { marketId, result: "already_finalized", message: MESSAGES.already_finalized, finalization: res.finalization };
  return {
    marketId,
    result: "scored",
    message: MESSAGES.scored,
    finalization,
    provenance: decision.provenance,
    roomsScored: finalization.roomsScored,
    scoresWritten: finalization.scoresWritten,
    globalScoresWritten: finalization.globalScoresWritten,
  };
}

export const MAX_PENDING_BATCH = 10;

/** Finalize up to `limit` (≤ 10) markets that have forecasts and no finalization, one by one. */
export async function finalizePending(deps: FinalizeDeps, limit: number): Promise<FinalizeReport[]> {
  const ids = await deps.repo.listUnfinalizedMarkets({ limit: Math.max(1, Math.min(MAX_PENDING_BATCH, limit)) });
  const out: FinalizeReport[] = [];
  for (const id of ids) out.push(await finalizeMarket(deps, id));
  return out;
}
