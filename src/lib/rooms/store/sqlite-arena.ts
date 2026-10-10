import "server-only";

/**
 * Arena tables + operations for the SQLite room repository (same file, lock
 * and atomic replace as rooms/forecasts; see sqlite.ts).
 *
 *  - market_finalizations: one row per market (PK), immutable (triggers)
 *  - forecast_scores:      room-specific score, UNIQUE (room_id, wallet),
 *                          FK → the exact forecast_revisions row, immutable
 *  - global_scores:        one per (wallet, market_id), FK → forecast_scores,
 *                          immutable
 *  - reputation:           maintained aggregate per wallet (count, Σ brierE8,
 *                          first/last scored, rank_key), updated only inside
 *                          the finalization transaction; can't shrink (trigger)
 * Rankings read the (ranked, rank_key) index; no table scans per request.
 */

import type { Database, SqlValue } from "sql.js";
import { nextReputation, reputationView, type GlobalScoreRecord, type MarketForecastSnapshot, type ReputationRecord, type ScoreRecord, type SnapshotRoom } from "@/lib/arena/scoring";
import { FinalizationIntegrityError, validateCommit, type CommitFinalizationInput, type CommitFinalizationResult, type FinalizationRecord, type Page, type WalletRoom } from "@/lib/arena/types";

export const ARENA_MIGRATION_SQL = `
  CREATE INDEX forecasts_wallet ON forecasts (wallet, room_id);

  CREATE TABLE market_finalizations (
    market_id       TEXT    PRIMARY KEY,
    status          TEXT    NOT NULL CHECK (status IN ('scored', 'blocked')),
    outcome         TEXT    CHECK (outcome IN ('yes', 'no')),
    cutoff_at       INTEGER,
    finalized_at    INTEGER NOT NULL,
    provenance      TEXT    NOT NULL,
    rooms_scored    INTEGER NOT NULL DEFAULT 0,
    scores_written  INTEGER NOT NULL DEFAULT 0,
    global_written  INTEGER NOT NULL DEFAULT 0,
    CHECK ((status = 'scored' AND outcome IS NOT NULL AND cutoff_at IS NOT NULL) OR (status = 'blocked' AND outcome IS NULL AND scores_written = 0))
  );
  CREATE TRIGGER market_finalizations_immutable_update BEFORE UPDATE ON market_finalizations
    BEGIN SELECT RAISE(ABORT, 'finalizations are immutable'); END;
  CREATE TRIGGER market_finalizations_immutable_delete BEFORE DELETE ON market_finalizations
    BEGIN SELECT RAISE(ABORT, 'finalizations are immutable'); END;

  CREATE TABLE forecast_scores (
    score_id                 TEXT    PRIMARY KEY,
    room_id                  TEXT    NOT NULL REFERENCES rooms (room_id),
    market_id                TEXT    NOT NULL REFERENCES market_finalizations (market_id),
    wallet                   TEXT    NOT NULL,
    forecast_id              TEXT    NOT NULL,
    forecast_revision        INTEGER NOT NULL CHECK (forecast_revision >= 1),
    forecast_probability_bps INTEGER NOT NULL CHECK (forecast_probability_bps BETWEEN 0 AND 10000),
    forecast_submitted_at    INTEGER NOT NULL,
    first_forecast_at        INTEGER NOT NULL,
    resolved_outcome         TEXT    NOT NULL CHECK (resolved_outcome IN ('yes', 'no')),
    brier_e8                 INTEGER NOT NULL CHECK (brier_e8 BETWEEN 0 AND 100000000),
    display_score_c          INTEGER NOT NULL CHECK (display_score_c BETWEEN 0 AND 10000),
    finalized_at             INTEGER NOT NULL,
    UNIQUE (room_id, wallet),
    FOREIGN KEY (room_id, wallet, forecast_revision) REFERENCES forecast_revisions (room_id, wallet, revision)
  );
  CREATE INDEX forecast_scores_room_rank ON forecast_scores (room_id, brier_e8, first_forecast_at, wallet);
  CREATE TRIGGER forecast_scores_immutable_update BEFORE UPDATE ON forecast_scores
    BEGIN SELECT RAISE(ABORT, 'scores are immutable'); END;
  CREATE TRIGGER forecast_scores_immutable_delete BEFORE DELETE ON forecast_scores
    BEGIN SELECT RAISE(ABORT, 'scores are immutable'); END;

  CREATE TABLE global_scores (
    wallet     TEXT NOT NULL,
    market_id  TEXT NOT NULL REFERENCES market_finalizations (market_id),
    score_id   TEXT NOT NULL UNIQUE REFERENCES forecast_scores (score_id),
    finalized_at INTEGER NOT NULL,
    PRIMARY KEY (wallet, market_id)
  );
  CREATE INDEX global_scores_wallet_recent ON global_scores (wallet, finalized_at DESC, market_id);
  CREATE TRIGGER global_scores_immutable_update BEFORE UPDATE ON global_scores
    BEGIN SELECT RAISE(ABORT, 'scores are immutable'); END;
  CREATE TRIGGER global_scores_immutable_delete BEFORE DELETE ON global_scores
    BEGIN SELECT RAISE(ABORT, 'scores are immutable'); END;

  CREATE TABLE reputation (
    wallet          TEXT    PRIMARY KEY,
    scored_count    INTEGER NOT NULL CHECK (scored_count >= 1),
    sum_brier_e8    INTEGER NOT NULL CHECK (sum_brier_e8 >= 0),
    first_scored_at INTEGER NOT NULL,
    last_scored_at  INTEGER NOT NULL,
    ranked          INTEGER NOT NULL CHECK (ranked IN (0, 1)),
    rank_key        TEXT    NOT NULL
  );
  CREATE INDEX reputation_rank ON reputation (ranked, rank_key);
  CREATE TRIGGER reputation_never_shrinks BEFORE UPDATE ON reputation
    WHEN NEW.scored_count <= OLD.scored_count OR NEW.sum_brier_e8 < OLD.sum_brier_e8
    BEGIN SELECT RAISE(ABORT, 'reputation only grows by finalization'); END;
  CREATE TRIGGER reputation_no_delete BEFORE DELETE ON reputation
    BEGIN SELECT RAISE(ABORT, 'reputation rows are permanent'); END;
`;

type Row = Record<string, SqlValue>;
type Q = {
  all: (db: Database, sql: string, params?: SqlValue[]) => Row[];
  one: (db: Database, sql: string, params?: SqlValue[]) => Row | null;
  tx: <T>(db: Database, fn: () => T) => T;
};

const SCORE_COLS =
  "score_id, room_id, market_id, wallet, forecast_id, forecast_revision, forecast_probability_bps, forecast_submitted_at, first_forecast_at, resolved_outcome, brier_e8, display_score_c, finalized_at";
const SCORE_COLS_S = SCORE_COLS.split(", ").map((c) => `s.${c}`).join(", ");

const toScore = (r: Row): ScoreRecord => ({
  scoreId: String(r.score_id),
  roomId: String(r.room_id),
  marketId: String(r.market_id),
  wallet: String(r.wallet),
  forecastId: String(r.forecast_id),
  forecastRevision: Number(r.forecast_revision),
  forecastProbabilityBps: Number(r.forecast_probability_bps),
  forecastSubmittedAt: Number(r.forecast_submitted_at),
  firstForecastAt: Number(r.first_forecast_at),
  resolvedOutcome: r.resolved_outcome === "yes" ? "yes" : "no",
  brierE8: Number(r.brier_e8),
  displayScoreC: Number(r.display_score_c),
  finalizedAt: Number(r.finalized_at),
});

const toRep = (r: Row): ReputationRecord => ({
  wallet: String(r.wallet),
  scoredCount: Number(r.scored_count),
  sumBrierE8: Number(r.sum_brier_e8),
  firstScoredAt: Number(r.first_scored_at),
  lastScoredAt: Number(r.last_scored_at),
});

const toFinal = (r: Row): FinalizationRecord => ({
  marketId: String(r.market_id),
  status: r.status === "scored" ? "scored" : "blocked",
  outcome: r.outcome === "yes" || r.outcome === "no" ? r.outcome : null,
  cutoffAt: r.cutoff_at === null ? null : Number(r.cutoff_at),
  finalizedAt: Number(r.finalized_at),
  provenance: JSON.parse(String(r.provenance)),
  roomsScored: Number(r.rooms_scored),
  scoresWritten: Number(r.scores_written),
  globalScoresWritten: Number(r.global_written),
});

export function getMarketForecastSnapshotSql(db: Database, q: Q, marketId: string): MarketForecastSnapshot {
  const rooms = new Map<string, SnapshotRoom>();
  for (const r of q.all(db, "SELECT room_id, market_id FROM rooms WHERE market_id = ? ORDER BY room_id", [marketId])) {
    rooms.set(String(r.room_id), { roomId: String(r.room_id), marketId: String(r.market_id), forecasters: [] });
  }
  const forecasters = new Map<string, SnapshotRoom["forecasters"][number]>();
  for (const f of q.all(db, "SELECT f.room_id, f.wallet, f.forecast_id FROM forecasts f JOIN rooms m ON m.room_id = f.room_id WHERE m.market_id = ? ORDER BY f.room_id, f.wallet", [marketId])) {
    const entry = { wallet: String(f.wallet), forecastId: String(f.forecast_id), revisions: [] };
    rooms.get(String(f.room_id))?.forecasters.push(entry);
    forecasters.set(`${f.room_id}|${f.wallet}`, entry);
  }
  for (const r of q.all(
    db,
    "SELECT v.room_id, v.wallet, v.forecast_id, v.revision, v.probability_bps, v.created_at FROM forecast_revisions v JOIN rooms m ON m.room_id = v.room_id WHERE m.market_id = ? ORDER BY v.room_id, v.wallet, v.revision",
    [marketId],
  )) {
    forecasters.get(`${r.room_id}|${r.wallet}`)?.revisions.push({
      forecastId: String(r.forecast_id),
      revision: Number(r.revision),
      probabilityBps: Number(r.probability_bps),
      createdAt: Number(r.created_at),
    });
  }
  return { marketId, rooms: [...rooms.values()] };
}

export function getFinalizationSql(db: Database, q: Q, marketId: string): FinalizationRecord | null {
  const r = q.one(db, "SELECT * FROM market_finalizations WHERE market_id = ?", [marketId]);
  return r ? toFinal(r) : null;
}

export function commitFinalizationSql(db: Database, q: Q, input: CommitFinalizationInput): [CommitFinalizationResult, boolean] {
  const f = input.finalization;
  const existing = getFinalizationSql(db, q, f.marketId);
  if (existing) return [{ status: "exists", finalization: existing }, false];
  validateCommit(input);
  q.tx(db, () => {
    db.run(
      "INSERT INTO market_finalizations (market_id, status, outcome, cutoff_at, finalized_at, provenance, rooms_scored, scores_written, global_written) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [f.marketId, f.status, f.outcome, f.cutoffAt, f.finalizedAt, JSON.stringify(f.provenance), f.roomsScored, f.scoresWritten, f.globalScoresWritten],
    );
    for (const s of input.roomScores) {
      // The auditable link: the score must point at the exact stored revision, same probability, before the cutoff.
      const rev = q.one(db, "SELECT probability_bps, created_at, forecast_id FROM forecast_revisions WHERE room_id = ? AND wallet = ? AND revision = ?", [s.roomId, s.wallet, s.forecastRevision]);
      const room = q.one(db, "SELECT market_id FROM rooms WHERE room_id = ?", [s.roomId]);
      if (!rev || Number(rev.probability_bps) !== s.forecastProbabilityBps || Number(rev.created_at) !== s.forecastSubmittedAt || String(rev.forecast_id) !== s.forecastId) {
        throw new FinalizationIntegrityError("score does not match the stored revision");
      }
      if (!room || String(room.market_id) !== f.marketId) throw new FinalizationIntegrityError("room is not on this market");
      db.run(`INSERT INTO forecast_scores (${SCORE_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        s.scoreId,
        s.roomId,
        s.marketId,
        s.wallet,
        s.forecastId,
        s.forecastRevision,
        s.forecastProbabilityBps,
        s.forecastSubmittedAt,
        s.firstForecastAt,
        s.resolvedOutcome,
        s.brierE8,
        s.displayScoreC,
        s.finalizedAt,
      ]);
    }
    for (const g of input.globalScores) {
      db.run("INSERT INTO global_scores (wallet, market_id, score_id, finalized_at) VALUES (?, ?, ?, ?)", [g.wallet, g.marketId, g.scoreId, g.finalizedAt]);
      const prevRow = q.one(db, "SELECT * FROM reputation WHERE wallet = ?", [g.wallet]);
      const next = reputationView(nextReputation(prevRow ? toRep(prevRow) : null, g.wallet, [g]));
      db.run(
        `INSERT INTO reputation (wallet, scored_count, sum_brier_e8, first_scored_at, last_scored_at, ranked, rank_key) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (wallet) DO UPDATE SET scored_count = excluded.scored_count, sum_brier_e8 = excluded.sum_brier_e8,
           first_scored_at = excluded.first_scored_at, last_scored_at = excluded.last_scored_at, ranked = excluded.ranked, rank_key = excluded.rank_key`,
        [next.wallet, next.scoredCount, next.sumBrierE8, next.firstScoredAt, next.lastScoredAt, next.ranked ? 1 : 0, next.rankKey],
      );
    }
  });
  return [{ status: "committed", finalization: f }, true];
}

export function listForecastersSql(db: Database, q: Q, tier: "ranked" | "provisional", limit: number, offset: number): Page<ReputationRecord> {
  const ranked = tier === "ranked" ? 1 : 0;
  const items = q.all(db, "SELECT * FROM reputation WHERE ranked = ? ORDER BY rank_key LIMIT ? OFFSET ?", [ranked, limit, offset]).map(toRep);
  const total = Number(q.one(db, "SELECT COUNT(*) AS n FROM reputation WHERE ranked = ?", [ranked])?.n ?? 0);
  return { items, total };
}

export function getReputationSql(db: Database, q: Q, wallet: string): ReputationRecord | null {
  const r = q.one(db, "SELECT * FROM reputation WHERE wallet = ?", [wallet]);
  return r ? toRep(r) : null;
}

export function getRankSql(db: Database, q: Q, wallet: string): number | null {
  const r = q.one(db, "SELECT ranked, rank_key FROM reputation WHERE wallet = ?", [wallet]);
  if (!r || Number(r.ranked) !== 1) return null;
  return Number(q.one(db, "SELECT COUNT(*) AS n FROM reputation WHERE ranked = 1 AND rank_key < ?", [String(r.rank_key)])?.n ?? 0) + 1;
}

export function countPendingMarketsSql(db: Database, q: Q, wallets: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of wallets) {
    out[w] = Number(
      q.one(
        db,
        `SELECT COUNT(DISTINCT m.market_id) AS n FROM forecasts f JOIN rooms m ON m.room_id = f.room_id
         WHERE f.wallet = ? AND NOT EXISTS (SELECT 1 FROM market_finalizations z WHERE z.market_id = m.market_id AND z.status = 'scored')`,
        [w],
      )?.n ?? 0,
    );
  }
  return out;
}

export function listGlobalScoresSql(db: Database, q: Q, wallet: string, limit: number, offset: number): Page<GlobalScoreRecord> {
  const items = q
    .all(db, `SELECT ${SCORE_COLS_S} FROM global_scores g JOIN forecast_scores s ON s.score_id = g.score_id WHERE g.wallet = ? ORDER BY g.finalized_at DESC, g.market_id ASC LIMIT ? OFFSET ?`, [wallet, limit, offset])
    .map(toScore);
  const total = Number(q.one(db, "SELECT COUNT(*) AS n FROM global_scores WHERE wallet = ?", [wallet])?.n ?? 0);
  return { items, total };
}

export function listRoomScoresSql(db: Database, q: Q, roomId: string, limit: number, offset: number): Page<ScoreRecord> {
  const items = q
    .all(db, `SELECT ${SCORE_COLS} FROM forecast_scores WHERE room_id = ? ORDER BY brier_e8 ASC, first_forecast_at ASC, wallet ASC LIMIT ? OFFSET ?`, [roomId, limit, offset])
    .map(toScore);
  const total = Number(q.one(db, "SELECT COUNT(*) AS n FROM forecast_scores WHERE room_id = ?", [roomId])?.n ?? 0);
  return { items, total };
}

export function getRoomScoreSql(db: Database, q: Q, roomId: string, wallet: string): ScoreRecord | null {
  const r = q.one(db, `SELECT ${SCORE_COLS} FROM forecast_scores WHERE room_id = ? AND wallet = ?`, [roomId, wallet]);
  return r ? toScore(r) : null;
}

export function getGlobalScoreSql(db: Database, q: Q, wallet: string, marketId: string): GlobalScoreRecord | null {
  const r = q.one(db, `SELECT ${SCORE_COLS_S} FROM global_scores g JOIN forecast_scores s ON s.score_id = g.score_id WHERE g.wallet = ? AND g.market_id = ?`, [wallet, marketId]);
  return r ? toScore(r) : null;
}

export function listWalletRoomsSql(db: Database, q: Q, wallet: string, limit: number): WalletRoom[] {
  return q
    .all(db, "SELECT f.room_id, m.market_id, f.created_at FROM forecasts f JOIN rooms m ON m.room_id = f.room_id WHERE f.wallet = ? ORDER BY f.created_at DESC, f.room_id LIMIT ?", [wallet, limit])
    .map((r) => ({ roomId: String(r.room_id), marketId: String(r.market_id), firstForecastAt: Number(r.created_at) }));
}

export function listUnfinalizedMarketsSql(db: Database, q: Q, limit: number): string[] {
  return q
    .all(
      db,
      `SELECT m.market_id, MIN(f.created_at) AS first FROM forecasts f JOIN rooms m ON m.room_id = f.room_id
       WHERE NOT EXISTS (SELECT 1 FROM market_finalizations z WHERE z.market_id = m.market_id)
       GROUP BY m.market_id ORDER BY first ASC, m.market_id ASC LIMIT ?`,
      [limit],
    )
    .map((r) => String(r.market_id));
}
