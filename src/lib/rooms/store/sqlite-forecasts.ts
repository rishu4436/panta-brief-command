import "server-only";

/**
 * Forecast tables + operations for the SQLite room repository (same file,
 * same lock, same atomic replace; see sqlite.ts). Called only from inside
 * SqliteRoomRepository's read()/write() wrappers.
 *
 *  - forecasts:          CURRENT forecast, UNIQUE (room_id, wallet)
 *  - forecast_revisions: immutable history, UNIQUE (room_id, wallet, revision);
 *                        UPDATE / DELETE are aborted by triggers
 *  - forecast_idempotency: (room_id, wallet, idem_key) → revision it produced
 * Aggregates are SQL aggregates over the indexed current table (no rows are
 * loaded into JS to compute them).
 */

import type { Database, SqlValue } from "sql.js";
import {
  BUCKET_COUNT,
  emptyAggregate,
  type ForecastAggregate,
  type ForecastRecord,
  type ForecastRevisionRecord,
} from "@/lib/forecasts/domain";
import { ForecastRevisionConflictError, type SubmitForecastCommand, type SubmitForecastResult } from "@/lib/forecasts/types";
import { IdempotencyConflictError, RoomNotFoundError, RoomStoreUnavailableError } from "./types";

export const FORECAST_MIGRATION_SQL = `
  CREATE TABLE forecasts (
    forecast_id     TEXT    PRIMARY KEY,
    room_id         TEXT    NOT NULL REFERENCES rooms (room_id),
    wallet          TEXT    NOT NULL,
    probability_bps INTEGER NOT NULL CHECK (probability_bps BETWEEN 0 AND 10000),
    reasoning       TEXT    NOT NULL DEFAULT '' CHECK (length(reasoning) <= 1000),
    revision        INTEGER NOT NULL CHECK (revision >= 1),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE (room_id, wallet)
  );
  CREATE INDEX forecasts_room_updated ON forecasts (room_id, updated_at DESC, wallet);

  CREATE TABLE forecast_revisions (
    forecast_id     TEXT    NOT NULL REFERENCES forecasts (forecast_id),
    room_id         TEXT    NOT NULL,
    wallet          TEXT    NOT NULL,
    revision        INTEGER NOT NULL CHECK (revision >= 1),
    probability_bps INTEGER NOT NULL CHECK (probability_bps BETWEEN 0 AND 10000),
    reasoning       TEXT    NOT NULL DEFAULT '' CHECK (length(reasoning) <= 1000),
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (room_id, wallet, revision)
  );
  CREATE TRIGGER forecast_revisions_immutable_update BEFORE UPDATE ON forecast_revisions
    BEGIN SELECT RAISE(ABORT, 'forecast history is immutable'); END;
  CREATE TRIGGER forecast_revisions_immutable_delete BEFORE DELETE ON forecast_revisions
    BEGIN SELECT RAISE(ABORT, 'forecast history is immutable'); END;

  CREATE TABLE forecast_idempotency (
    room_id      TEXT    NOT NULL,
    wallet       TEXT    NOT NULL,
    idem_key     TEXT    NOT NULL,
    request_hash TEXT    NOT NULL,
    revision     INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (room_id, wallet, idem_key)
  );
`;

type Row = Record<string, SqlValue>;
type Q = {
  all: (db: Database, sql: string, params?: SqlValue[]) => Row[];
  one: (db: Database, sql: string, params?: SqlValue[]) => Row | null;
  tx: <T>(db: Database, fn: () => T) => T;
};

const CUR_COLS = "forecast_id, room_id, wallet, probability_bps, reasoning, revision, created_at, updated_at";
const REV_COLS = "forecast_id, room_id, wallet, revision, probability_bps, reasoning, created_at";

const toForecast = (r: Row): ForecastRecord => ({
  forecastId: String(r.forecast_id),
  roomId: String(r.room_id),
  wallet: String(r.wallet),
  probabilityBps: Number(r.probability_bps),
  reasoning: String(r.reasoning ?? ""),
  revision: Number(r.revision),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const toRevision = (r: Row): ForecastRevisionRecord => ({
  forecastId: String(r.forecast_id),
  roomId: String(r.room_id),
  wallet: String(r.wallet),
  revision: Number(r.revision),
  probabilityBps: Number(r.probability_bps),
  reasoning: String(r.reasoning ?? ""),
  createdAt: Number(r.created_at),
});

export function submitForecastSql(
  db: Database,
  q: Q,
  cmd: SubmitForecastCommand,
  idem: { key: string; fingerprint: string },
): [SubmitForecastResult, boolean] {
  const prior = q.one(db, "SELECT request_hash, revision FROM forecast_idempotency WHERE room_id = ? AND wallet = ? AND idem_key = ?", [
    cmd.roomId,
    cmd.wallet,
    idem.key,
  ]);
  if (prior) {
    if (prior.request_hash !== idem.fingerprint) throw new IdempotencyConflictError();
    const cur = q.one(db, `SELECT ${CUR_COLS} FROM forecasts WHERE room_id = ? AND wallet = ?`, [cmd.roomId, cmd.wallet]);
    const rev = q.one(db, `SELECT ${REV_COLS} FROM forecast_revisions WHERE room_id = ? AND wallet = ? AND revision = ?`, [
      cmd.roomId,
      cmd.wallet,
      Number(prior.revision),
    ]);
    if (!cur || !rev) throw new RoomStoreUnavailableError("failure", "forecast idempotency record points at a missing revision");
    const c = toForecast(cur);
    const r = toRevision(rev);
    return [
      {
        status: "replayed",
        forecast: { ...c, probabilityBps: r.probabilityBps, reasoning: r.reasoning, revision: r.revision, updatedAt: r.createdAt },
      },
      false,
    ];
  }

  if (!q.one(db, "SELECT 1 AS x FROM rooms WHERE room_id = ? AND status = 'active'", [cmd.roomId])) throw new RoomNotFoundError();
  const curRow = q.one(db, `SELECT ${CUR_COLS} FROM forecasts WHERE room_id = ? AND wallet = ?`, [cmd.roomId, cmd.wallet]);
  const cur = curRow ? toForecast(curRow) : null;
  const currentRevision = cur?.revision ?? 0;
  if (cmd.expectedRevision !== currentRevision) throw new ForecastRevisionConflictError(currentRevision);

  const next: ForecastRecord = cur
    ? {
        ...cur,
        probabilityBps: cmd.probabilityBps,
        reasoning: cmd.reasoning,
        revision: cur.revision + 1,
        updatedAt: Math.max(cmd.now, cur.updatedAt),
      }
    : {
        forecastId: cmd.newForecastId,
        roomId: cmd.roomId,
        wallet: cmd.wallet,
        probabilityBps: cmd.probabilityBps,
        reasoning: cmd.reasoning,
        revision: 1,
        createdAt: cmd.now,
        updatedAt: cmd.now,
      };

  q.tx(db, () => {
    if (cur) {
      db.run(
        "UPDATE forecasts SET probability_bps = ?, reasoning = ?, revision = ?, updated_at = ? WHERE room_id = ? AND wallet = ? AND revision = ?",
        [next.probabilityBps, next.reasoning, next.revision, next.updatedAt, cmd.roomId, cmd.wallet, currentRevision],
      );
      if (db.getRowsModified() !== 1) throw new ForecastRevisionConflictError(currentRevision);
    } else {
      db.run(`INSERT INTO forecasts (${CUR_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        next.forecastId,
        next.roomId,
        next.wallet,
        next.probabilityBps,
        next.reasoning,
        next.revision,
        next.createdAt,
        next.updatedAt,
      ]);
    }
    db.run(`INSERT INTO forecast_revisions (${REV_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      next.forecastId,
      next.roomId,
      next.wallet,
      next.revision,
      next.probabilityBps,
      next.reasoning,
      next.updatedAt,
    ]);
    db.run(
      "INSERT INTO forecast_idempotency (room_id, wallet, idem_key, request_hash, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [cmd.roomId, cmd.wallet, idem.key, idem.fingerprint, next.revision, cmd.now],
    );
  });
  return [{ status: cur ? "revised" : "created", forecast: next }, true];
}

export function getCurrentForecastSql(db: Database, q: Q, roomId: string, wallet: string): ForecastRecord | null {
  const r = q.one(db, `SELECT ${CUR_COLS} FROM forecasts WHERE room_id = ? AND wallet = ?`, [roomId, wallet]);
  return r ? toForecast(r) : null;
}

export function getForecastHistorySql(db: Database, q: Q, roomId: string, wallet: string, limit: number): ForecastRevisionRecord[] {
  return q
    .all(db, `SELECT ${REV_COLS} FROM forecast_revisions WHERE room_id = ? AND wallet = ? ORDER BY revision DESC LIMIT ?`, [roomId, wallet, limit])
    .map(toRevision);
}

export function listCurrentForecastsSql(db: Database, q: Q, roomId: string, limit: number, offset: number) {
  const items = q
    .all(db, `SELECT ${CUR_COLS} FROM forecasts WHERE room_id = ? ORDER BY updated_at DESC, wallet ASC LIMIT ? OFFSET ?`, [roomId, limit, offset])
    .map(toForecast);
  const total = Number(q.one(db, "SELECT COUNT(*) AS n FROM forecasts WHERE room_id = ?", [roomId])?.n ?? 0);
  return { items, total };
}

export function getForecastAggregateSql(db: Database, q: Q, roomId: string): ForecastAggregate {
  const agg = emptyAggregate();
  const totals = q.one(db, "SELECT COUNT(*) AS n, COALESCE(SUM(probability_bps), 0) AS s FROM forecasts WHERE room_id = ?", [roomId]);
  agg.participants = Number(totals?.n ?? 0);
  agg.sumBps = Number(totals?.s ?? 0);
  for (const r of q.all(
    db,
    `SELECT MIN(${BUCKET_COUNT - 1}, probability_bps / 1000) AS b, COUNT(*) AS n FROM forecasts WHERE room_id = ? GROUP BY b`,
    [roomId],
  )) {
    agg.buckets[Number(r.b)] = Number(r.n);
  }
  return agg;
}

export function countForecastParticipantsSql(db: Database, q: Q, roomId: string): number {
  return Number(q.one(db, "SELECT COUNT(*) AS n FROM forecasts WHERE room_id = ?", [roomId])?.n ?? 0);
}
