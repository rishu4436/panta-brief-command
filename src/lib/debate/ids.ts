import "server-only";

/** Stable ids for debate records (server side; hashing needs node:crypto). */

import { createHash } from "node:crypto";
import type { DebateEvidence, Provenance, Side } from "./domain";

const h = (s: string, n: number) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, n);

/** Content id: the same source text read the same way gets the same id. */
export const evidenceIdFor = (provenance: Provenance, url: string | null, excerpt: string) => `ev_${h(`${provenance}\u0000${url ?? ""}\u0000${excerpt}`, 12)}`;
export const claimIdFor = (debateId: string, side: Side, index: number) => `clm_${h(`${debateId}\u0000${side}\u0000${index}`, 16)}`;
export const debateIdFor = (roomId: string, snapshotId: string, version: string, createdAt: number, nonce: string) => `dbt_${h(`${roomId}\u0000${snapshotId}\u0000${version}\u0000${createdAt}\u0000${nonce}`, 20)}`;
export const challengeIdFor = (debateId: string, claimId: string, wallet: string, idemKey: string) => `chl_${h(`${debateId}\u0000${claimId}\u0000${wallet}\u0000${idemKey}`, 20)}`;

/** Snapshot of the inputs (evidence content + lifecycle + version): same inputs → same id. */
export function sourceSnapshotIdFor(evidence: Pick<DebateEvidence, "provenance" | "sourceUrl" | "excerpt">[], lifecycle: string, version: string): string {
  const parts = evidence.map((e) => `${e.provenance}\u0000${e.sourceUrl ?? ""}\u0000${e.excerpt}`).sort();
  return `src_${h(`${version}\u0001${lifecycle}\u0001${parts.join("\u0001")}`, 24)}`;
}
