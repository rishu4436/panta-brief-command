/**
 * Debate persistence contract (implemented by the room adapters: SQLite and
 * Upstash Redis). Guarantees every adapter must provide:
 *  - a debate is written once and never changed (a retry with the same
 *    idempotency key, or the same debate id, returns the stored one);
 *  - the debate, its index entry, its idempotency record and the retention
 *    trim (keep the newest K per room, deleting older debates and their
 *    challenges) happen in ONE atomic step;
 *  - one generation lock per room (set-if-absent with expiry; released only
 *    by its holder's token);
 *  - challenges are appended atomically with per-claim and per-debate caps
 *    and per-wallet idempotency; history is append-only;
 *  - reads are bounded (newest K debates, newest N challenges); no scans.
 */

import type { DebateBundle, DebateChallenge, DebateSummary } from "./domain";

export type SaveDebateResult = { status: "created" | "replayed"; debateId: string };
export type AddChallengeResult = { status: "created" | "replayed"; challenge: DebateChallenge };

export interface DebateRepository {
  saveDebate(bundle: DebateBundle, opts: { idempotencyKey: string; keepLast: number; idemTtlMs: number }): Promise<SaveDebateResult>;
  findDebateByIdempotencyKey(roomId: string, key: string): Promise<string | null>;
  getDebate(roomId: string, debateId: string): Promise<DebateBundle | null>;
  getLatestDebate(roomId: string): Promise<DebateBundle | null>;
  listDebates(roomId: string, opts: { limit: number }): Promise<DebateSummary[]>;
  acquireDebateLock(roomId: string, token: string, ttlMs: number): Promise<boolean>;
  releaseDebateLock(roomId: string, token: string): Promise<void>;
  isDebateLocked(roomId: string): Promise<boolean>;
  addChallenge(
    roomId: string,
    challenge: DebateChallenge,
    opts: { idempotencyKey: string; fingerprint: string; maxPerClaim: number; maxPerDebate: number; idemTtlMs: number },
  ): Promise<AddChallengeResult>;
  findChallengeByIdempotencyKey(roomId: string, wallet: string, key: string): Promise<{ fingerprint: string; challenge: DebateChallenge } | null>;
  listChallenges(roomId: string, debateId: string, opts: { limit: number }): Promise<DebateChallenge[]>;
}

export class ChallengeLimitError extends Error {
  constructor(public scope: "claim" | "debate") {
    super(scope === "claim" ? "this claim has reached its challenge limit" : "this debate has reached its challenge limit");
    this.name = "ChallengeLimitError";
  }
}

export class DebateNotFoundError extends Error {
  constructor() {
    super("debate not found");
    this.name = "DebateNotFoundError";
  }
}
