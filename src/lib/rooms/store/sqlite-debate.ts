import "server-only";

/**
 * AI Debate Arena tables + operations for the SQLite room repository (same
 * file, lock and atomic replace; see sqlite.ts).
 *
 *  - debates:                 one row per debate snapshot; the claims and
 *                             evidence are stored with it as one validated JSON
 *                             bundle; UPDATE is aborted by a trigger (immutable);
 *                             rows beyond the newest K per room are deleted
 *                             (retention) in the same transaction as the insert
 *  - debate_idempotency:      (room_id, idem_key) → debate_id (24 h)
 *  - debate_locks:            one generation lock per room (token + expiry)
 *  - debate_challenges:       append-only; UPDATE aborted; deleted only with
 *                             their debate (ON DELETE CASCADE)
 *  - debate_challenge_idempotency: (wallet, idem_key) → challenge (24 h)
 * Every read is by primary key or a (room_id, created_at) / (debate_id, …)
 * index with a LIMIT.
 */

import type { Database, SqlValue } from "sql.js";
import { DebateBundleSchema, DebateChallengeSchema, type DebateBundle, type DebateChallenge, type DebateSummary } from "@/lib/debate/domain";
import { ChallengeLimitError, DebateNotFoundError, type AddChallengeResult, type SaveDebateResult } from "@/lib/debate/types";
import { IdempotencyConflictError, RoomNotFoundError, RoomStoreUnavailableError } from "./types";

export const DEBATE_MIGRATION_SQL = `
  CREATE TABLE debates (
    debate_id          TEXT    PRIMARY KEY,
    room_id            TEXT    NOT NULL REFERENCES rooms (room_id),
    market_id          TEXT    NOT NULL,
    generation_version TEXT    NOT NULL,
    source_snapshot_id TEXT    NOT NULL,
    status             TEXT    NOT NULL CHECK (status IN ('ready', 'insufficient_evidence')),
    created_at         INTEGER NOT NULL,
    expires_at         INTEGER NOT NULL,
    body               TEXT    NOT NULL CHECK (length(body) <= 200000)
  );
  CREATE INDEX debates_room_recent ON debates (room_id, created_at DESC, debate_id DESC);
  CREATE TRIGGER debates_immutable_update BEFORE UPDATE ON debates
    BEGIN SELECT RAISE(ABORT, 'debates are immutable'); END;

  CREATE TABLE debate_idempotency (
    room_id    TEXT    NOT NULL,
    idem_key   TEXT    NOT NULL,
    debate_id  TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, idem_key)
  );
  CREATE INDEX debate_idempotency_age ON debate_idempotency (created_at);

  CREATE TABLE debate_locks (
    room_id    TEXT    PRIMARY KEY,
    token      TEXT    NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE debate_challenges (
    challenge_id TEXT    PRIMARY KEY,
    debate_id    TEXT    NOT NULL REFERENCES debates (debate_id) ON DELETE CASCADE,
    room_id      TEXT    NOT NULL,
    claim_id     TEXT    NOT NULL,
    wallet       TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    body         TEXT    NOT NULL CHECK (length(body) <= 20000)
  );
  CREATE INDEX debate_challenges_debate ON debate_challenges (debate_id, created_at, challenge_id);
  CREATE INDEX debate_challenges_claim ON debate_challenges (debate_id, claim_id);
  CREATE TRIGGER debate_challenges_immutable_update BEFORE UPDATE ON debate_challenges
    BEGIN SELECT RAISE(ABORT, 'challenges are immutable'); END;

  CREATE TABLE debate_challenge_idempotency (
    wallet       TEXT    NOT NULL,
    idem_key     TEXT    NOT NULL,
    fingerprint  TEXT    NOT NULL,
    challenge_id TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (wallet, idem_key)
  );
  CREATE INDEX debate_challenge_idempotency_age ON debate_challenge_idempotency (created_at);
`;

type Row = Record<string, SqlValue>;
type Q = {
  all: (db: Database, sql: string, params?: SqlValue[]) => Row[];
  one: (db: Database, sql: string, params?: SqlValue[]) => Row | null;
  tx: <T>(db: Database, fn: () => T) => T;
};

function parseBundle(body: SqlValue): DebateBundle {
  const r = DebateBundleSchema.safeParse(JSON.parse(String(body)));
  if (!r.success) throw new RoomStoreUnavailableError("failure", "stored debate failed validation");
  return r.data;
}
function parseChallenge(body: SqlValue): DebateChallenge {
  const r = DebateChallengeSchema.safeParse(JSON.parse(String(body)));
  if (!r.success) throw new RoomStoreUnavailableError("failure", "stored challenge failed validation");
  return r.data;
}

export function saveDebateSql(db: Database, q: Q, bundle: DebateBundle, opts: { idempotencyKey: string; keepLast: number; idemTtlMs: number }): [SaveDebateResult, boolean] {
  if (!DebateBundleSchema.safeParse(bundle).success) throw new RoomStoreUnavailableError("failure", "refusing to store an invalid debate");
  const d = bundle.debate;
  const now = Date.now();
  const prior = q.one(db, "SELECT debate_id FROM debate_idempotency WHERE room_id = ? AND idem_key = ? AND created_at > ?", [d.roomId, opts.idempotencyKey, now - opts.idemTtlMs]);
  if (prior) return [{ status: "replayed", debateId: String(prior.debate_id) }, false];
  if (q.one(db, "SELECT 1 AS x FROM debates WHERE debate_id = ?", [d.debateId])) return [{ status: "replayed", debateId: d.debateId }, false];
  if (!q.one(db, "SELECT 1 AS x FROM rooms WHERE room_id = ?", [d.roomId])) throw new RoomNotFoundError();
  q.tx(db, () => {
    db.run("DELETE FROM debate_idempotency WHERE created_at <= ?", [now - opts.idemTtlMs]);
    db.run(
      "INSERT INTO debates (debate_id, room_id, market_id, generation_version, source_snapshot_id, status, created_at, expires_at, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [d.debateId, d.roomId, d.marketId, d.generationVersion, d.sourceSnapshotId, d.status, d.createdAt, d.expiresAt, JSON.stringify(bundle)],
    );
    db.run("INSERT OR REPLACE INTO debate_idempotency (room_id, idem_key, debate_id, created_at) VALUES (?, ?, ?, ?)", [d.roomId, opts.idempotencyKey, d.debateId, now]);
    // Retention: keep the newest K per room (challenges go with them via ON DELETE CASCADE).
    db.run(
      `DELETE FROM debates WHERE room_id = ? AND debate_id NOT IN (
         SELECT debate_id FROM debates WHERE room_id = ? ORDER BY created_at DESC, debate_id DESC LIMIT ?)`,
      [d.roomId, d.roomId, Math.max(1, opts.keepLast)],
    );
  });
  return [{ status: "created", debateId: d.debateId }, true];
}

export function findDebateByIdempotencyKeySql(db: Database, q: Q, roomId: string, key: string, ttlMs: number): string | null {
  const r = q.one(db, "SELECT debate_id FROM debate_idempotency WHERE room_id = ? AND idem_key = ? AND created_at > ?", [roomId, key, Date.now() - ttlMs]);
  return r ? String(r.debate_id) : null;
}

export function getDebateSql(db: Database, q: Q, roomId: string, debateId: string): DebateBundle | null {
  const r = q.one(db, "SELECT body FROM debates WHERE debate_id = ? AND room_id = ?", [debateId, roomId]);
  return r ? parseBundle(r.body) : null;
}

export function getLatestDebateSql(db: Database, q: Q, roomId: string): DebateBundle | null {
  const r = q.one(db, "SELECT body FROM debates WHERE room_id = ? ORDER BY created_at DESC, debate_id DESC LIMIT 1", [roomId]);
  return r ? parseBundle(r.body) : null;
}

export function listDebatesSql(db: Database, q: Q, roomId: string, limit: number): DebateSummary[] {
  return q
    .all(db, "SELECT debate_id, created_at, expires_at, status, generation_version FROM debates WHERE room_id = ? ORDER BY created_at DESC, debate_id DESC LIMIT ?", [roomId, limit])
    .map((r) => ({ debateId: String(r.debate_id), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), status: r.status === "insufficient_evidence" ? "insufficient_evidence" : "ready", generationVersion: String(r.generation_version) }));
}

export function acquireDebateLockSql(db: Database, q: Q, roomId: string, token: string, ttlMs: number): [boolean, boolean] {
  const now = Date.now();
  const cur = q.one(db, "SELECT token, expires_at FROM debate_locks WHERE room_id = ?", [roomId]);
  if (cur && Number(cur.expires_at) > now) return [false, false];
  q.tx(db, () => db.run("INSERT OR REPLACE INTO debate_locks (room_id, token, expires_at) VALUES (?, ?, ?)", [roomId, token, now + ttlMs]));
  return [true, true];
}

export function releaseDebateLockSql(db: Database, q: Q, roomId: string, token: string): [void, boolean] {
  const cur = q.one(db, "SELECT token FROM debate_locks WHERE room_id = ?", [roomId]);
  if (!cur || String(cur.token) !== token) return [undefined, false];
  q.tx(db, () => db.run("DELETE FROM debate_locks WHERE room_id = ? AND token = ?", [roomId, token]));
  return [undefined, true];
}

export function isDebateLockedSql(db: Database, q: Q, roomId: string): boolean {
  const cur = q.one(db, "SELECT expires_at FROM debate_locks WHERE room_id = ?", [roomId]);
  return Boolean(cur && Number(cur.expires_at) > Date.now());
}

export function addChallengeSql(
  db: Database,
  q: Q,
  roomId: string,
  ch: DebateChallenge,
  opts: { idempotencyKey: string; fingerprint: string; maxPerClaim: number; maxPerDebate: number; idemTtlMs: number },
): [AddChallengeResult, boolean] {
  if (!DebateChallengeSchema.safeParse(ch).success) throw new RoomStoreUnavailableError("failure", "refusing to store an invalid challenge");
  const now = Date.now();
  const prior = q.one(db, "SELECT fingerprint, challenge_id FROM debate_challenge_idempotency WHERE wallet = ? AND idem_key = ? AND created_at > ?", [ch.wallet, opts.idempotencyKey, now - opts.idemTtlMs]);
  if (prior) {
    if (String(prior.fingerprint) !== opts.fingerprint) throw new IdempotencyConflictError();
    const row = q.one(db, "SELECT body FROM debate_challenges WHERE challenge_id = ?", [String(prior.challenge_id)]);
    if (!row) throw new DebateNotFoundError(); // its debate was removed by retention
    return [{ status: "replayed", challenge: parseChallenge(row.body) }, false];
  }
  if (!q.one(db, "SELECT 1 AS x FROM debates WHERE debate_id = ? AND room_id = ?", [ch.debateId, roomId])) throw new DebateNotFoundError();
  const perClaim = Number(q.one(db, "SELECT COUNT(*) AS n FROM debate_challenges WHERE debate_id = ? AND claim_id = ?", [ch.debateId, ch.claimId])?.n ?? 0);
  if (perClaim >= opts.maxPerClaim) throw new ChallengeLimitError("claim");
  const perDebate = Number(q.one(db, "SELECT COUNT(*) AS n FROM debate_challenges WHERE debate_id = ?", [ch.debateId])?.n ?? 0);
  if (perDebate >= opts.maxPerDebate) throw new ChallengeLimitError("debate");
  q.tx(db, () => {
    db.run("DELETE FROM debate_challenge_idempotency WHERE created_at <= ?", [now - opts.idemTtlMs]);
    db.run("INSERT INTO debate_challenges (challenge_id, debate_id, room_id, claim_id, wallet, created_at, body) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      ch.challengeId,
      ch.debateId,
      roomId,
      ch.claimId,
      ch.wallet,
      ch.createdAt,
      JSON.stringify(ch),
    ]);
    db.run("INSERT INTO debate_challenge_idempotency (wallet, idem_key, fingerprint, challenge_id, created_at) VALUES (?, ?, ?, ?, ?)", [ch.wallet, opts.idempotencyKey, opts.fingerprint, ch.challengeId, now]);
  });
  return [{ status: "created", challenge: ch }, true];
}

export function findChallengeByIdempotencyKeySql(db: Database, q: Q, roomId: string, wallet: string, key: string, ttlMs: number): { fingerprint: string; challenge: DebateChallenge } | null {
  const prior = q.one(db, "SELECT fingerprint, challenge_id FROM debate_challenge_idempotency WHERE wallet = ? AND idem_key = ? AND created_at > ?", [wallet, key, Date.now() - ttlMs]);
  if (!prior) return null;
  const row = q.one(db, "SELECT body FROM debate_challenges WHERE challenge_id = ? AND room_id = ?", [String(prior.challenge_id), roomId]);
  return row ? { fingerprint: String(prior.fingerprint), challenge: parseChallenge(row.body) } : null;
}

export function listChallengesSql(db: Database, q: Q, roomId: string, debateId: string, limit: number): DebateChallenge[] {
  return q.all(db, "SELECT body FROM debate_challenges WHERE debate_id = ? AND room_id = ? ORDER BY created_at ASC, challenge_id ASC LIMIT ?", [debateId, roomId, limit]).map((r) => parseChallenge(r.body));
}
