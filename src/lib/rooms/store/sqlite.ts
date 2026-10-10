import "server-only";

/**
 * SQLite room repository for local development and self-hosted single-node
 * deployments. Uses sql.js (SQLite compiled to WebAssembly): no native build,
 * so it installs anywhere Node runs. The database is one file on disk:
 *
 *  - every operation opens the current file, runs inside a transaction and,
 *    if it changed anything, writes the whole database to a temp file, fsyncs
 *    it and renames it over the original (atomic replace, never a torn file);
 *  - writers are serialised by an in-process queue plus an exclusive lock file
 *    (`<db>.lock`, stale after LOCK_STALE_MS), so two processes on the same
 *    file cannot lose each other's writes;
 *  - uniqueness (slug, idempotency key, nonce; one current forecast per
 *    room+wallet; one history row per revision) is enforced by SQLite UNIQUE /
 *    PRIMARY KEY constraints, and every statement is parameterised.
 *
 * Not for Vercel: serverless instances have no shared durable disk, so
 * store/index.ts never selects this adapter there.
 *
 * Schema + migrations: see MIGRATIONS below and docs/PREDICTION_ROOMS.md.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import type { RoomRecord } from "../domain";
import type { SubmitForecastCommand } from "@/lib/forecasts/types";
import {
  FORECAST_MIGRATION_SQL,
  countForecastParticipantsSql,
  getCurrentForecastSql,
  getForecastAggregateSql,
  getForecastHistorySql,
  listCurrentForecastsSql,
  submitForecastSql,
} from "./sqlite-forecasts";
import {
  ForecastRevisionConflictError,
  IdempotencyConflictError,
  RoomForbiddenError,
  RoomNotFoundError,
  RoomStoreUnavailableError,
  SlugTakenError,
  type AuthChallengeRecord,
  type CreateRoomResult,
  type NewRoom,
  type RoomRepository,
} from "./types";

/** Ordered, append-only. Never edit a shipped migration; add a new version. */
export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE rooms (
        room_id        TEXT    PRIMARY KEY,
        slug           TEXT    NOT NULL UNIQUE,
        title          TEXT    NOT NULL,
        description    TEXT    NOT NULL DEFAULT '',
        creator_wallet TEXT    NOT NULL,
        market_id      TEXT    NOT NULL,
        visibility     TEXT    NOT NULL CHECK (visibility IN ('public', 'unlisted')),
        status         TEXT    NOT NULL CHECK (status IN ('active', 'archived')),
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );
      CREATE INDEX rooms_public_created ON rooms (visibility, status, created_at DESC);
      CREATE INDEX rooms_creator_created ON rooms (creator_wallet, created_at DESC);
      CREATE INDEX rooms_market ON rooms (market_id);

      CREATE TABLE room_idempotency (
        creator_wallet TEXT    NOT NULL,
        idem_key       TEXT    NOT NULL,
        request_hash   TEXT    NOT NULL,
        room_id        TEXT    NOT NULL REFERENCES rooms (room_id),
        created_at     INTEGER NOT NULL,
        PRIMARY KEY (creator_wallet, idem_key)
      );

      CREATE TABLE auth_challenges (
        nonce      TEXT    PRIMARY KEY,
        wallet     TEXT    NOT NULL,
        message    TEXT    NOT NULL,
        domain     TEXT    NOT NULL,
        issued_at  INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX auth_challenges_expiry ON auth_challenges (expires_at);
    `,
  },
  { version: 2, sql: FORECAST_MIGRATION_SQL },
];

const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 15_000;
/** Expired challenges are swept on each new challenge (kept a minute for diagnostics). */
const CHALLENGE_SWEEP_GRACE_MS = 60_000;

let sqlPromise: Promise<SqlJsStatic> | null = null;

function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= (async () => {
    const mod = await import("sql.js");
    const initSqlJs = (mod as unknown as { default?: typeof mod.default }).default ?? (mod as unknown as typeof mod.default);
    const wasmPath = path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
    const buf = await fs.readFile(wasmPath);
    const wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return initSqlJs({ wasmBinary });
  })().catch((e) => {
    sqlPromise = null;
    throw e;
  });
  return sqlPromise;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-process write queue per database file. */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(file, tail);
  void tail.then(() => {
    if (queues.get(file) === tail) queues.delete(file);
  });
  return run;
}

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const h = await fs.open(lockPath, "wx");
      await h.writeFile(`${process.pid}\n`);
      await h.close();
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        const st = await fs.stat(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(lockPath).catch(() => undefined);
          continue;
        }
      } catch {
        continue; // lock vanished between open and stat
      }
      if (Date.now() > deadline) throw new RoomStoreUnavailableError("failure", "room database is locked by another process");
      await sleep(15 + Math.floor(Math.random() * 20));
    }
  }
}

type Row = Record<string, SqlValue>;

function all(db: Database, sql: string, params: SqlValue[] = []): Row[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const out: Row[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as Row);
    return out;
  } finally {
    stmt.free();
  }
}

const one = (db: Database, sql: string, params: SqlValue[] = []): Row | null => all(db, sql, params)[0] ?? null;

function toRecord(r: Row): RoomRecord {
  return {
    roomId: String(r.room_id),
    slug: String(r.slug),
    title: String(r.title),
    description: String(r.description ?? ""),
    creatorWallet: String(r.creator_wallet),
    marketId: String(r.market_id),
    visibility: r.visibility === "unlisted" ? "unlisted" : "public",
    status: r.status === "archived" ? "archived" : "active",
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toChallenge(r: Row): AuthChallengeRecord {
  return {
    nonce: String(r.nonce),
    wallet: String(r.wallet),
    message: String(r.message),
    domain: String(r.domain),
    issuedAt: Number(r.issued_at),
    expiresAt: Number(r.expires_at),
  };
}

const ROOM_COLUMNS =
  "room_id, slug, title, description, creator_wallet, market_id, visibility, status, created_at, updated_at";

/** Apply pending migrations; returns true if the schema changed. */
export function migrate(db: Database): boolean {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const cur = Number(one(db, "SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")?.v ?? 0);
  let changed = false;
  for (const m of MIGRATIONS) {
    if (m.version <= cur) continue;
    db.run("BEGIN");
    try {
      db.exec(m.sql);
      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [m.version, Date.now()]);
      db.run("COMMIT");
      changed = true;
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  }
  return changed;
}

const isUnique = (e: unknown, what: string) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message) && e.message.includes(what);

export class SqliteRoomRepository implements RoomRepository {
  readonly kind = "sqlite" as const;
  readonly durable = true;

  constructor(private readonly file: string) {}

  /** Open the current database file (or a new one), migrated. */
  private async open(): Promise<{ db: Database; dirty: boolean }> {
    const SQL = await loadSql();
    let bytes: Buffer | null = null;
    try {
      bytes = await fs.readFile(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const db = bytes && bytes.length ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
    db.run("PRAGMA foreign_keys = ON");
    const dirty = migrate(db);
    return { db, dirty };
  }

  private async persist(db: Database): Promise<void> {
    const data = db.export();
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    const h = await fs.open(tmp, "w", 0o600);
    try {
      await h.writeFile(data);
      await h.sync();
    } finally {
      await h.close();
    }
    await fs.rename(tmp, this.file);
  }

  private wrap(e: unknown): never {
    if (
      e instanceof SlugTakenError ||
      e instanceof IdempotencyConflictError ||
      e instanceof RoomNotFoundError ||
      e instanceof RoomForbiddenError ||
      e instanceof RoomStoreUnavailableError ||
      e instanceof ForecastRevisionConflictError
    ) {
      throw e;
    }
    throw new RoomStoreUnavailableError("failure", e instanceof Error ? e.message.slice(0, 160) : "sqlite failure");
  }

  /** Read-only: no lock needed (writers replace the file atomically). */
  private async read<T>(fn: (db: Database) => T): Promise<T> {
    try {
      const { db } = await this.open();
      try {
        return fn(db);
      } finally {
        db.close();
      }
    } catch (e) {
      this.wrap(e);
    }
  }

  /** Exclusive read-modify-write; `fn` returns [result, changed]. */
  private write<T>(fn: (db: Database) => [T, boolean]): Promise<T> {
    return enqueue(this.file, async () => {
      const lock = `${this.file}.lock`;
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await acquireLock(lock);
      } catch (e) {
        this.wrap(e);
      }
      try {
        const { db, dirty } = await this.open();
        try {
          const [result, changed] = fn(db);
          if (changed || dirty) await this.persist(db);
          return result;
        } finally {
          db.close();
        }
      } catch (e) {
        this.wrap(e);
      } finally {
        await fs.unlink(lock).catch(() => undefined);
      }
    });
  }

  private tx<T>(db: Database, fn: () => T): T {
    db.run("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.run("COMMIT");
      return out;
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  }

  createRoom(room: NewRoom, idem: { key: string; fingerprint: string }): Promise<CreateRoomResult> {
    return this.write<CreateRoomResult>((db) => {
      const prior = one(db, "SELECT room_id, request_hash FROM room_idempotency WHERE creator_wallet = ? AND idem_key = ?", [
        room.creatorWallet,
        idem.key,
      ]);
      if (prior) {
        if (prior.request_hash !== idem.fingerprint) throw new IdempotencyConflictError();
        const existing = one(db, `SELECT ${ROOM_COLUMNS} FROM rooms WHERE room_id = ?`, [String(prior.room_id)]);
        if (!existing) throw new RoomStoreUnavailableError("failure", "idempotency record points at a missing room");
        return [{ status: "replayed", room: toRecord(existing) }, false];
      }
      const record: RoomRecord = { ...room, status: room.status ?? "active", updatedAt: room.createdAt };
      this.tx(db, () => {
        try {
          db.run(
            `INSERT INTO rooms (${ROOM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              record.roomId,
              record.slug,
              record.title,
              record.description,
              record.creatorWallet,
              record.marketId,
              record.visibility,
              record.status,
              record.createdAt,
              record.updatedAt,
            ],
          );
        } catch (e) {
          if (isUnique(e, "rooms.slug")) throw new SlugTakenError(record.slug);
          throw e;
        }
        db.run(
          "INSERT INTO room_idempotency (creator_wallet, idem_key, request_hash, room_id, created_at) VALUES (?, ?, ?, ?, ?)",
          [record.creatorWallet, idem.key, idem.fingerprint, record.roomId, record.createdAt],
        );
      });
      return [{ status: "created", room: record }, true];
    });
  }

  getRoomById(roomId: string) {
    return this.read((db) => {
      const r = one(db, `SELECT ${ROOM_COLUMNS} FROM rooms WHERE room_id = ?`, [roomId]);
      return r ? toRecord(r) : null;
    });
  }

  getRoomBySlug(slug: string) {
    return this.read((db) => {
      const r = one(db, `SELECT ${ROOM_COLUMNS} FROM rooms WHERE slug = ?`, [slug]);
      return r ? toRecord(r) : null;
    });
  }

  listPublicRooms({ limit }: { limit: number }) {
    return this.read((db) =>
      all(
        db,
        `SELECT ${ROOM_COLUMNS} FROM rooms WHERE visibility = 'public' AND status = 'active' ORDER BY created_at DESC, room_id DESC LIMIT ?`,
        [limit],
      ).map(toRecord),
    );
  }

  listRoomsByCreator(wallet: string, { limit, includeUnlisted }: { limit: number; includeUnlisted: boolean }) {
    return this.read((db) =>
      all(
        db,
        `SELECT ${ROOM_COLUMNS} FROM rooms WHERE creator_wallet = ? AND status = 'active' ${
          includeUnlisted ? "" : "AND visibility = 'public'"
        } ORDER BY created_at DESC, room_id DESC LIMIT ?`,
        [wallet, limit],
      ).map(toRecord),
    );
  }

  isSlugTaken(slug: string) {
    return this.read((db) => one(db, "SELECT 1 AS x FROM rooms WHERE slug = ?", [slug]) !== null);
  }

  updateRoom(roomId: string, actorWallet: string, patch: { title?: string; description?: string }, now: number) {
    return this.write((db) => {
      const r = one(db, `SELECT ${ROOM_COLUMNS} FROM rooms WHERE room_id = ?`, [roomId]);
      if (!r) throw new RoomNotFoundError();
      const cur = toRecord(r);
      if (cur.creatorWallet !== actorWallet) throw new RoomForbiddenError();
      const next: RoomRecord = {
        ...cur,
        title: patch.title ?? cur.title,
        description: patch.description ?? cur.description,
        updatedAt: Math.max(now, cur.updatedAt),
      };
      this.tx(db, () => {
        db.run("UPDATE rooms SET title = ?, description = ?, updated_at = ? WHERE room_id = ? AND creator_wallet = ?", [
          next.title,
          next.description,
          next.updatedAt,
          roomId,
          actorWallet,
        ]);
      });
      return [next, true];
    });
  }

  saveChallenge(c: AuthChallengeRecord) {
    return this.write((db) => {
      this.tx(db, () => {
        db.run("DELETE FROM auth_challenges WHERE expires_at < ?", [c.issuedAt - CHALLENGE_SWEEP_GRACE_MS]);
        db.run(
          "INSERT INTO auth_challenges (nonce, wallet, message, domain, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
          [c.nonce, c.wallet, c.message, c.domain, c.issuedAt, c.expiresAt],
        );
      });
      return [undefined, true];
    });
  }

  consumeChallenge(nonce: string) {
    return this.write((db) => {
      const r = one(db, "SELECT nonce, wallet, message, domain, issued_at, expires_at FROM auth_challenges WHERE nonce = ?", [nonce]);
      if (!r) return [null, false];
      this.tx(db, () => db.run("DELETE FROM auth_challenges WHERE nonce = ?", [nonce]));
      return [toChallenge(r), true];
    });
  }

  // ------------------------------------------------------------ forecasts

  private readonly q = { all, one, tx: <T>(db: Database, fn: () => T) => this.tx(db, fn) };

  submitForecast(cmd: SubmitForecastCommand, idem: { key: string; fingerprint: string }) {
    return this.write((db) => submitForecastSql(db, this.q, cmd, idem));
  }

  getCurrentForecast(roomId: string, wallet: string) {
    return this.read((db) => getCurrentForecastSql(db, this.q, roomId, wallet));
  }

  getForecastHistory(roomId: string, wallet: string, { limit }: { limit: number }) {
    return this.read((db) => getForecastHistorySql(db, this.q, roomId, wallet, limit));
  }

  listCurrentForecasts(roomId: string, { limit, offset }: { limit: number; offset: number }) {
    return this.read((db) => listCurrentForecastsSql(db, this.q, roomId, limit, offset));
  }

  getForecastAggregate(roomId: string) {
    return this.read((db) => getForecastAggregateSql(db, this.q, roomId));
  }

  countForecastParticipants(roomId: string) {
    return this.read((db) => countForecastParticipantsSql(db, this.q, roomId));
  }
}
