import "server-only";

/**
 * Creator Growth Studio on SQLite (local dev / self-hosted). Participation
 * stats are derived by indexed joins on the durable forecast tables (nothing
 * to maintain); distribution counters live in studio_counters with a
 * dedupe table. Every event is one write transaction (like all SQLite writes
 * here, the file is rewritten: fine for local use, not for traffic).
 */

import type { Database, SqlValue } from "sql.js";
import {
  ANALYTICS_RETENTION_DAYS,
  DEDUPE_TTL_MS,
  isDynamicMetric,
  MAX_DAY_FIELDS,
  MAX_DYNAMIC_FIELDS_PER_ROOM_DAY,
  METRIC,
  utcDay,
} from "@/lib/studio/domain";
import type { CounterRow, CreatorStats, RecordEventCommand, RecordEventResult } from "@/lib/studio/types";

export const STUDIO_MIGRATION_SQL = `
  CREATE TABLE studio_counters (
    creator_wallet TEXT    NOT NULL,
    day            TEXT    NOT NULL CHECK (length(day) = 10),
    room_id        TEXT    NOT NULL,
    metric         TEXT    NOT NULL CHECK (length(metric) <= 120),
    count          INTEGER NOT NULL CHECK (count >= 0),
    PRIMARY KEY (creator_wallet, day, room_id, metric)
  );
  CREATE INDEX studio_counters_day ON studio_counters (day);

  CREATE TABLE studio_dedupe (
    dedupe_key TEXT    PRIMARY KEY CHECK (length(dedupe_key) <= 80),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX studio_dedupe_expiry ON studio_dedupe (expires_at);
`;

type Row = Record<string, SqlValue>;
type Q = {
  all: (db: Database, sql: string, params?: SqlValue[]) => Row[];
  one: (db: Database, sql: string, params?: SqlValue[]) => Row | null;
  tx: <T>(db: Database, fn: () => T) => T;
};

/** Shared by both adapters: where a dynamic metric folds when the per-room cap is hit. */
export function overflowMetric(metric: string): string {
  return metric.startsWith("src:h:") ? METRIC.srcOther : METRIC.campaignOther;
}

export function getCreatorStatsSql(db: Database, q: Q, wallet: string, sinceMs: number, maxFirst: number): CreatorStats {
  const unique = Number(
    q.one(db, "SELECT COUNT(DISTINCT f.wallet) AS n FROM forecasts f JOIN rooms r ON r.room_id = f.room_id WHERE r.creator_wallet = ?", [wallet])?.n ?? 0,
  );
  const returning = Number(
    q.one(
      db,
      `SELECT COUNT(*) AS n FROM (
         SELECT f.wallet FROM forecasts f JOIN rooms r ON r.room_id = f.room_id
         WHERE r.creator_wallet = ? GROUP BY f.wallet HAVING COUNT(DISTINCT f.room_id) >= 2
       )`,
      [wallet],
    )?.n ?? 0,
  );
  const revisionsByRoom: Record<string, number> = {};
  for (const row of q.all(
    db,
    "SELECT fr.room_id AS room_id, COUNT(*) AS n FROM forecast_revisions fr JOIN rooms r ON r.room_id = fr.room_id WHERE r.creator_wallet = ? GROUP BY fr.room_id",
    [wallet],
  )) {
    revisionsByRoom[String(row.room_id)] = Number(row.n);
  }
  const firstForecastTimes = q
    .all(
      db,
      `SELECT MIN(f.created_at) AS t FROM forecasts f JOIN rooms r ON r.room_id = f.room_id
       WHERE r.creator_wallet = ? GROUP BY f.wallet HAVING t >= ? ORDER BY t ASC LIMIT ?`,
      [wallet, sinceMs, maxFirst],
    )
    .map((r) => Number(r.t));
  return { uniqueForecasters: unique, returningForecasters: returning, revisionsByRoom, firstForecastTimes, approximate: false };
}

export function countRoomChallengesSql(db: Database, q: Q, roomId: string): number {
  return Number(
    q.one(db, "SELECT COUNT(*) AS n FROM debate_challenges c JOIN debates d ON d.debate_id = c.debate_id WHERE d.room_id = ?", [roomId])?.n ?? 0,
  );
}

export function recordStudioEventSql(db: Database, q: Q, cmd: RecordEventCommand): [RecordEventResult, boolean] {
  return q.tx(db, () => {
    db.run("DELETE FROM studio_dedupe WHERE expires_at <= ?", [cmd.nowMs]);
    if (q.one(db, "SELECT 1 AS x FROM studio_dedupe WHERE dedupe_key = ?", [cmd.dedupeKey])) return ["duplicate", true] as [RecordEventResult, boolean];
    db.run("INSERT INTO studio_dedupe (dedupe_key, expires_at) VALUES (?, ?)", [cmd.dedupeKey, cmd.nowMs + DEDUPE_TTL_MS]);
    db.run("DELETE FROM studio_counters WHERE day < ?", [utcDay(cmd.nowMs - ANALYTICS_RETENTION_DAYS * 86_400_000)]);

    let dayFields = Number(q.one(db, "SELECT COUNT(*) AS n FROM studio_counters WHERE creator_wallet = ? AND day = ?", [cmd.creatorWallet, cmd.day])?.n ?? 0);
    let dyn = Number(
      q.one(
        db,
        `SELECT COUNT(*) AS n FROM studio_counters WHERE creator_wallet = ? AND day = ? AND room_id = ?
         AND (metric LIKE 'src:h:%' OR (metric LIKE 'c:%' AND metric <> 'c:other'))`,
        [cmd.creatorWallet, cmd.day, cmd.roomId],
      )?.n ?? 0,
    );
    const exists = (m: string) =>
      q.one(db, "SELECT 1 AS x FROM studio_counters WHERE creator_wallet = ? AND day = ? AND room_id = ? AND metric = ?", [cmd.creatorWallet, cmd.day, cmd.roomId, m]) !== null;
    let counted = 0;
    for (const raw of cmd.metrics) {
      let m = raw;
      if (isDynamicMetric(m) && !exists(m) && dyn >= MAX_DYNAMIC_FIELDS_PER_ROOM_DAY) m = overflowMetric(m);
      const isNew = !exists(m);
      if (isNew && dayFields >= MAX_DAY_FIELDS) continue;
      db.run(
        `INSERT INTO studio_counters (creator_wallet, day, room_id, metric, count) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT (creator_wallet, day, room_id, metric) DO UPDATE SET count = count + 1`,
        [cmd.creatorWallet, cmd.day, cmd.roomId, m],
      );
      if (isNew) {
        dayFields += 1;
        if (isDynamicMetric(m)) dyn += 1;
      }
      counted += 1;
    }
    return [counted > 0 ? "counted" : "capped", true] as [RecordEventResult, boolean];
  });
}

export function listStudioCountersSql(db: Database, q: Q, wallet: string, days: string[]): CounterRow[] {
  if (!days.length) return [];
  const sorted = [...days].sort();
  return q
    .all(
      db,
      "SELECT day, room_id, metric, count FROM studio_counters WHERE creator_wallet = ? AND day >= ? AND day <= ? ORDER BY day, room_id, metric",
      [wallet, sorted[0], sorted[sorted.length - 1]],
    )
    .filter((r) => days.includes(String(r.day)))
    .map((r) => ({ day: String(r.day), roomId: String(r.room_id), metric: String(r.metric), count: Number(r.count) }));
}
