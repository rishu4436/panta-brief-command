/**
 * Arena persistence contract (implemented by the room adapters: SQLite and
 * Upstash Redis). Guarantees every adapter must provide:
 *  - at most one finalization per market; once written it never changes
 *    (a retry returns the stored one: no rescoring);
 *  - score records are immutable and unique per (roomId, wallet); global
 *    scores unique per (wallet, marketId);
 *  - the finalization, all its score records, the reputation aggregates and
 *    the ranking indexes are written in ONE atomic step;
 *  - ranking order = byte order of `rankKey` (see scoring.ts).
 */

import type { ResolutionProvenance } from "./evidence";
import type { GlobalScoreRecord, MarketForecastSnapshot, Outcome, ReputationRecord, ScoreRecord } from "./scoring";

export type FinalizationRecord = {
  marketId: string;
  status: "scored" | "blocked";
  /** Only for "scored". */
  outcome: Outcome | null;
  cutoffAt: number | null;
  finalizedAt: number;
  provenance: ResolutionProvenance;
  roomsScored: number;
  scoresWritten: number;
  globalScoresWritten: number;
};

export type CommitFinalizationInput = {
  finalization: FinalizationRecord;
  roomScores: ScoreRecord[];
  globalScores: GlobalScoreRecord[];
};

export type CommitFinalizationResult = { status: "committed" | "exists"; finalization: FinalizationRecord };

export type WalletRoom = { roomId: string; marketId: string; firstForecastAt: number };

export type Page<T> = { items: T[]; total: number };

export interface ArenaRepository {
  /** Every room on the market with each forecaster's full revision history. */
  getMarketForecastSnapshot(marketId: string): Promise<MarketForecastSnapshot>;
  getFinalization(marketId: string): Promise<FinalizationRecord | null>;
  commitFinalization(input: CommitFinalizationInput): Promise<CommitFinalizationResult>;
  listForecasters(opts: { tier: "ranked" | "provisional"; limit: number; offset: number }): Promise<Page<ReputationRecord>>;
  getReputation(wallet: string): Promise<ReputationRecord | null>;
  /** 1-based position among ranked forecasters, or null. */
  getRank(wallet: string): Promise<number | null>;
  /** Markets the wallet forecast on that have no scored finalization yet. */
  countPendingMarkets(wallets: string[]): Promise<Record<string, number>>;
  listGlobalScores(wallet: string, opts: { limit: number; offset: number }): Promise<Page<GlobalScoreRecord>>;
  listRoomScores(roomId: string, opts: { limit: number; offset: number }): Promise<Page<ScoreRecord>>;
  getRoomScore(roomId: string, wallet: string): Promise<ScoreRecord | null>;
  getGlobalScore(wallet: string, marketId: string): Promise<GlobalScoreRecord | null>;
  listWalletRooms(wallet: string, opts: { limit: number }): Promise<WalletRoom[]>;
  /** Markets with forecasts and no finalization, oldest participation first. */
  listUnfinalizedMarkets(opts: { limit: number }): Promise<string[]>;
  /**
   * Index a (wallet, room, market) participation before the forecast write
   * (Redis secondary indexes; SQLite derives it by join and does nothing).
   */
  noteParticipation(p: { wallet: string; roomId: string; marketId: string; at: number }): Promise<void>;
}

export class FinalizationIntegrityError extends Error {
  constructor(detail: string) {
    super(`finalization rejected: ${detail}`);
    this.name = "FinalizationIntegrityError";
  }
}

/** Shared input checks (both adapters). */
export function validateCommit(input: CommitFinalizationInput): void {
  const f = input.finalization;
  if (f.status === "blocked" && (input.roomScores.length || input.globalScores.length || f.outcome !== null)) throw new FinalizationIntegrityError("a blocked market has no scores");
  if (f.status === "scored" && (!f.outcome || f.cutoffAt === null)) throw new FinalizationIntegrityError("a scored market needs an outcome and cutoff");
  const roomKeys = new Set<string>();
  for (const s of input.roomScores) {
    if (s.marketId !== f.marketId || s.resolvedOutcome !== f.outcome || s.finalizedAt !== f.finalizedAt) throw new FinalizationIntegrityError("score does not match its finalization");
    if (f.cutoffAt !== null && s.forecastSubmittedAt >= f.cutoffAt) throw new FinalizationIntegrityError("revision after the cutoff");
    const k = `${s.roomId}|${s.wallet}`;
    if (roomKeys.has(k)) throw new FinalizationIntegrityError("duplicate room score");
    roomKeys.add(k);
  }
  const wallets = new Set<string>();
  const ids = new Set(input.roomScores.map((s) => s.scoreId));
  for (const g of input.globalScores) {
    if (wallets.has(g.wallet)) throw new FinalizationIntegrityError("duplicate global score");
    wallets.add(g.wallet);
    if (!ids.has(g.scoreId)) throw new FinalizationIntegrityError("global score must be one of the room scores");
  }
  if (f.scoresWritten !== input.roomScores.length || f.globalScoresWritten !== input.globalScores.length) throw new FinalizationIntegrityError("counts don't match");
}
