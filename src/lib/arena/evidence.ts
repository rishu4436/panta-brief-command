/**
 * Resolution evidence → finalization decision (pure). See docs/ARENA.md.
 *
 * Two independent sources must agree before anything is scored:
 *  1. Panta's market record (GET /markets/{id}/): resolved === true and an
 *     explicit winning side (`yesWins` → outcome). A partial record counts as
 *     no evidence.
 *  2. The market's on-chain `Event` account (owned by the Panta program),
 *     read fresh: is_resolved and yes_wins, with the context slot.
 * Never inferred from prices, expiry, timestamps or AI.
 *
 *  - both final, same side      → "resolved" (scores may be written)
 *  - both final, different side → "blocked" (persisted: needs reconciliation)
 *  - cancelled (either source)  → "cancelled" (nothing scored)
 *  - anything else (unresolved, missing outcome, a source unreadable, no
 *    cutoff) → not scored, nothing persisted; safe to retry later.
 */

import type { ChainEventRead } from "@/lib/panta/chain-event-server";
import { PANTA_PROGRAM_ID } from "@/lib/panta/chain-events";
import { marketLifecycle } from "@/lib/panta/catalog";
import type { Market } from "@/lib/panta/domain";
import { isPartialMarket } from "@/lib/panta/markets";
import type { Outcome } from "./scoring";

export type DetailEvidenceRead = { status: "ok" | "not_found" | "failed"; detail: Market | null; fetchedAt: number; error?: string };

export type PantaEvidence = {
  source: "panta_market_record";
  endpoint: string;
  status: "ok" | "partial" | "not_found" | "failed";
  resolved: boolean | null;
  outcome: Outcome | null;
  lifecycle: string | null;
  primaryPhaseEndTime: number | null;
  endTime: number | null;
  fetchedAt: string;
};

export type ChainEvidence = {
  source: "solana_event_account";
  account: string;
  programOwner: string;
  status: "ok" | "not_found" | "failed";
  slot: number | null;
  isResolved: boolean | null;
  isCancelled: boolean | null;
  outcome: Outcome | null;
  resolvedAt: number | null;
  primaryPhaseEndTime: number | null;
  endTime: number | null;
  fetchedAt: string;
};

export type ResolutionProvenance = { marketId: string; panta: PantaEvidence; chain: ChainEvidence; decidedAt: string };

export type ResolutionDecision =
  | { kind: "resolved"; outcome: Outcome; cutoffAt: number; provenance: ResolutionProvenance }
  | { kind: "blocked"; reason: "outcome_conflict"; provenance: ResolutionProvenance }
  | { kind: "cancelled"; provenance: ResolutionProvenance }
  | { kind: "not_resolved"; provenance: ResolutionProvenance }
  | { kind: "missing_evidence"; reason: string; provenance: ResolutionProvenance };

const iso = (ms: number) => new Date(ms).toISOString();
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function pantaEvidence(marketId: string, read: DetailEvidenceRead, nowSec: number): PantaEvidence {
  const d = read.detail;
  const partial = Boolean(d && (d.partial || isPartialMarket(d)));
  const usable = read.status === "ok" && d && !partial ? d : null;
  return {
    source: "panta_market_record",
    endpoint: `GET /markets/${marketId}/`,
    status: read.status === "ok" ? (usable ? "ok" : "partial") : read.status,
    resolved: usable ? usable.resolved === true : null,
    // Outcome only from Panta's own resolved flag + yesWins (markets.ts parse rule).
    outcome: usable && usable.resolved === true && (usable.outcome === "yes" || usable.outcome === "no") ? usable.outcome : null,
    lifecycle: usable ? marketLifecycle(usable, nowSec) : null,
    primaryPhaseEndTime: usable && positive(usable.primaryPhaseEndTime) ? usable.primaryPhaseEndTime : null,
    endTime: usable && positive(usable.endTime) ? usable.endTime : null,
    fetchedAt: iso(read.fetchedAt),
  };
}

export function chainEvidence(marketId: string, read: ChainEventRead): ChainEvidence {
  const ev = read.status === "ok" ? read.event : null;
  return {
    source: "solana_event_account",
    account: marketId,
    programOwner: PANTA_PROGRAM_ID,
    status: read.status,
    slot: read.status === "failed" ? null : read.slot,
    isResolved: ev ? ev.isResolved : null,
    isCancelled: ev ? ev.isCancelled : null,
    // yes_wins is meaningful only once the account is resolved.
    outcome: ev && ev.isResolved ? (ev.yesWins ? "yes" : "no") : null,
    resolvedAt: ev && positive(ev.resolvedAt) ? ev.resolvedAt : null,
    primaryPhaseEndTime: ev && positive(ev.primaryPhaseEndTime) ? ev.primaryPhaseEndTime : null,
    endTime: ev && positive(ev.endTime) ? ev.endTime : null,
    fetchedAt: iso(read.fetchedAt),
  };
}

/** Forecast cutoff (same rule as the forecast window): earliest primaryPhaseEndTime / endTime reported. ms or null. */
export function scoringCutoffAt(p: PantaEvidence, c: ChainEvidence): number | null {
  const all = [p.primaryPhaseEndTime, p.endTime, c.primaryPhaseEndTime, c.endTime].filter(positive);
  const ppe = [p.primaryPhaseEndTime, c.primaryPhaseEndTime].filter(positive);
  return all.length && ppe.length ? Math.min(...all) * 1000 : null;
}

export function decideResolution(marketId: string, detail: DetailEvidenceRead, chain: ChainEventRead, nowMs: number): ResolutionDecision {
  const panta = pantaEvidence(marketId, detail, Math.floor(nowMs / 1000));
  const onchain = chainEvidence(marketId, chain);
  const provenance: ResolutionProvenance = { marketId, panta, chain: onchain, decidedAt: iso(nowMs) };
  if (onchain.isCancelled || panta.lifecycle === "cancelled") return { kind: "cancelled", provenance };
  if (panta.status !== "ok") return { kind: "missing_evidence", reason: `Panta market record ${panta.status}`, provenance };
  if (onchain.status !== "ok") return { kind: "missing_evidence", reason: `on-chain Event account ${onchain.status}`, provenance };
  if (!panta.resolved && !onchain.isResolved) return { kind: "not_resolved", provenance };
  if (!panta.outcome || !onchain.outcome) {
    // One source final, the other not yet (or no winning side): wait, don't guess.
    return { kind: "missing_evidence", reason: !panta.outcome ? "Panta has no final outcome yet" : "on-chain Event not resolved yet", provenance };
  }
  if (panta.outcome !== onchain.outcome) return { kind: "blocked", reason: "outcome_conflict", provenance };
  const cutoffAt = scoringCutoffAt(panta, onchain);
  if (cutoffAt === null) return { kind: "missing_evidence", reason: "no forecast cutoff (primaryPhaseEndTime) published", provenance };
  return { kind: "resolved", outcome: panta.outcome, cutoffAt, provenance };
}
