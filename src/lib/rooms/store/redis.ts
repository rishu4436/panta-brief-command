import "server-only";

/**
 * Upstash Redis room repository: the durable, multi-instance backend for
 * serverless production (Vercel). Selected automatically when the same
 * UPSTASH_REDIS_REST_URL/_TOKEN (or KV_REST_API_*) vars the shared store uses
 * are set.
 *
 * Atomicity comes from single Redis commands, no read-then-write races:
 *  - slug uniqueness:  SET rooms:slug:<slug> <roomId> NX
 *  - idempotency:      SET rooms:idem:<wallet>:<key> <roomId>|<hash> NX (7 days)
 *  - nonce single use: GETDEL rooms:challenge:<nonce>
 * The room body and its index entries are then written in one MULTI/EXEC.
 * If that write fails, the slug and idempotency claims are released.
 *
 * Forecasts: one Lua script per submission (see redis-forecasts.ts).
 *
 * Unlike rate limits, a failed call here never falls back to memory: the
 * caller gets RoomStoreUnavailableError and nothing is reported as saved.
 */

import { Redis } from "@upstash/redis";
import type { RoomRecord } from "../domain";
import type { SubmitForecastCommand } from "@/lib/forecasts/types";
import { FinalizationIntegrityError, type CommitFinalizationInput } from "@/lib/arena/types";
import {
  commitFinalizationRedis,
  countPendingMarketsRedis,
  getFinalizationRedis,
  getMarketForecastSnapshotRedis,
  getRankRedis,
  getRoomScoreRedis,
  getGlobalScoreRedis,
  getReputationRedis,
  listForecastersRedis,
  listGlobalScoresRedis,
  listRoomScoresRedis,
  listUnfinalizedMarketsRedis,
  listWalletRoomsRedis,
  noteParticipationRedis,
  type RedisArenaOps,
} from "./redis-arena";
import {
  countForecastParticipantsRedis,
  getCurrentForecastRedis,
  getForecastAggregateRedis,
  getForecastHistoryRedis,
  listCurrentForecastsRedis,
  submitForecastRedis,
  type RedisForecastOps,
} from "./redis-forecasts";
import {
  ForecastRevisionConflictError,
  CreateInProgressError,
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

export const ROOMS_REDIS_PREFIX = "pbc:rooms:v1:";
const IDEM_TTL_MS = 7 * 24 * 3600_000;
const CHALLENGE_GRACE_MS = 60_000;
const REDIS_TIMEOUT_MS = 4_000;

export type RedisWrite =
  | { op: "set"; key: string; value: string }
  | { op: "zadd"; key: string; score: number; member: string };

/** The handful of commands the adapter needs (Upstash in prod, a fake in tests). */
export interface RedisLike extends RedisForecastOps, RedisArenaOps {
  get(key: string): Promise<string | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  /** SET key value NX [PX ms]; true when this call created the key. */
  setNx(key: string, value: string, pxMs?: number): Promise<boolean>;
  setPx(key: string, value: string, pxMs: number): Promise<void>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  getdel(key: string): Promise<string | null>;
  /** Members by score, highest first, inclusive range. */
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  /** MULTI/EXEC: all or nothing. */
  multi(writes: RedisWrite[]): Promise<void>;
}

export function upstashRedisLike(url: string, token: string): RedisLike {
  const redis = new Redis({
    url,
    token,
    automaticDeserialization: false,
    retry: { retries: 1, backoff: () => 150 },
    signal: () => AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  const str = (v: unknown) => (v == null ? null : String(v));
  // With automaticDeserialization off, HMGET/HGETALL come back as raw arrays;
  // accept the object shape too so a client upgrade can't silently break reads.
  const pairs = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (Array.isArray(v)) for (let i = 0; i + 1 < v.length; i += 2) out[String(v[i])] = String(v[i + 1]);
    else if (v && typeof v === "object") for (const [f, x] of Object.entries(v)) if (x != null) out[f] = String(x);
    return out;
  };
  return {
    get: async (k) => str(await redis.get(k)),
    mget: async (keys) => (keys.length ? ((await redis.mget(...keys)) as unknown[]).map(str) : []),
    setNx: async (k, v, px) => (await redis.set(k, v, px ? { nx: true, px } : { nx: true })) === "OK",
    setPx: async (k, v, px) => {
      await redis.set(k, v, { px });
    },
    set: async (k, v) => {
      await redis.set(k, v);
    },
    del: async (k) => {
      await redis.del(k);
    },
    getdel: async (k) => str(await redis.getdel(k)),
    zrevrange: async (k, start, stop) => ((await redis.zrange(k, start, stop, { rev: true })) as unknown[]).map(String),
    hget: async (k, f) => str(await redis.hget(k, f)),
    hmget: async (k, fields) => {
      if (!fields.length) return [];
      const v = (await redis.hmget(k, ...fields)) as unknown;
      if (Array.isArray(v)) return v.map(str);
      const o = (v ?? {}) as Record<string, unknown>;
      return fields.map((f) => str(o[f]));
    },
    hgetall: async (k) => pairs(await redis.hgetall(k)),
    lrange: async (k, start, stop) => ((await redis.lrange(k, start, stop)) as unknown[]).map(String),
    zcard: async (k) => Number(await redis.zcard(k)) || 0,
    zrange: async (k, start, stop) => ((await redis.zrange(k, start, stop)) as unknown[]).map(String),
    zrank: async (k, m) => {
      const v = await redis.zrank(k, m);
      return v === null || v === undefined ? null : Number(v);
    },
    eval: async (script, keys, args) => redis.eval(script, keys, args),
    multi: async (writes) => {
      const tx = redis.multi();
      for (const w of writes) {
        if (w.op === "set") tx.set(w.key, w.value);
        else tx.zadd(w.key, { score: w.score, member: w.member });
      }
      await tx.exec();
    },
  };
}

const K = {
  room: (id: string) => `${ROOMS_REDIS_PREFIX}room:${id}`,
  slug: (slug: string) => `${ROOMS_REDIS_PREFIX}slug:${slug}`,
  idem: (wallet: string, key: string) => `${ROOMS_REDIS_PREFIX}idem:${wallet}:${key}`,
  publicIndex: () => `${ROOMS_REDIS_PREFIX}public`,
  creatorIndex: (wallet: string) => `${ROOMS_REDIS_PREFIX}creator:${wallet}`,
  challenge: (nonce: string) => `${ROOMS_REDIS_PREFIX}challenge:${nonce}`,
};

function parseRoom(raw: string | null): RoomRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as RoomRecord;
    if (typeof r?.roomId !== "string" || typeof r.slug !== "string") return null;
    return r;
  } catch {
    return null;
  }
}

export class RedisRoomRepository implements RoomRepository {
  readonly kind = "redis" as const;
  readonly durable = true;

  constructor(private readonly r: RedisLike) {}

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (
        e instanceof SlugTakenError ||
        e instanceof IdempotencyConflictError ||
        e instanceof RoomNotFoundError ||
        e instanceof RoomForbiddenError ||
        e instanceof RoomStoreUnavailableError ||
        e instanceof CreateInProgressError ||
        e instanceof ForecastRevisionConflictError ||
        e instanceof FinalizationIntegrityError
      ) {
        throw e;
      }
      throw new RoomStoreUnavailableError("failure", "Redis room store call failed");
    }
  }

  private async resolveIdem(value: string, fingerprint: string): Promise<CreateRoomResult> {
    const sep = value.indexOf("|");
    const roomId = sep > 0 ? value.slice(0, sep) : value;
    const fp = sep > 0 ? value.slice(sep + 1) : "";
    if (fp !== fingerprint) throw new IdempotencyConflictError();
    const room = parseRoom(await this.r.get(K.room(roomId)));
    if (!room) throw new CreateInProgressError();
    return { status: "replayed", room };
  }

  createRoom(room: NewRoom, idem: { key: string; fingerprint: string }): Promise<CreateRoomResult> {
    return this.call(async () => {
      const idemKey = K.idem(room.creatorWallet, idem.key);
      const prior = await this.r.get(idemKey);
      if (prior) return this.resolveIdem(prior, idem.fingerprint);

      const record: RoomRecord = { ...room, status: room.status ?? "active", updatedAt: room.createdAt };
      if (!(await this.r.setNx(idemKey, `${record.roomId}|${idem.fingerprint}`, IDEM_TTL_MS))) {
        const raced = await this.r.get(idemKey);
        if (raced) return this.resolveIdem(raced, idem.fingerprint);
        throw new CreateInProgressError();
      }
      if (!(await this.r.setNx(K.slug(record.slug), record.roomId))) {
        await this.r.del(idemKey).catch(() => undefined);
        throw new SlugTakenError(record.slug);
      }
      const writes: RedisWrite[] = [
        { op: "set", key: K.room(record.roomId), value: JSON.stringify(record) },
        { op: "zadd", key: K.creatorIndex(record.creatorWallet), score: record.createdAt, member: record.roomId },
      ];
      if (record.visibility === "public") {
        writes.push({ op: "zadd", key: K.publicIndex(), score: record.createdAt, member: record.roomId });
      }
      try {
        await this.r.multi(writes);
      } catch {
        await this.r.del(K.slug(record.slug)).catch(() => undefined);
        await this.r.del(idemKey).catch(() => undefined);
        throw new RoomStoreUnavailableError("failure", "room write failed; nothing was saved");
      }
      return { status: "created", room: record };
    });
  }

  getRoomById(roomId: string) {
    return this.call(async () => parseRoom(await this.r.get(K.room(roomId))));
  }

  getRoomBySlug(slug: string) {
    return this.call(async () => {
      const id = await this.r.get(K.slug(slug));
      if (!id) return null;
      const room = parseRoom(await this.r.get(K.room(id)));
      return room && room.slug === slug ? room : null;
    });
  }

  private async loadMany(ids: string[]): Promise<RoomRecord[]> {
    if (!ids.length) return [];
    const raws = await this.r.mget(ids.map(K.room));
    return raws.map(parseRoom).filter((x): x is RoomRecord => x !== null);
  }

  listPublicRooms({ limit }: { limit: number }) {
    return this.call(async () => {
      const ids = await this.r.zrevrange(K.publicIndex(), 0, limit - 1);
      return (await this.loadMany(ids)).filter((r) => r.visibility === "public" && r.status === "active");
    });
  }

  listRoomsByCreator(wallet: string, { limit, includeUnlisted }: { limit: number; includeUnlisted: boolean }) {
    return this.call(async () => {
      const ids = await this.r.zrevrange(K.creatorIndex(wallet), 0, limit - 1);
      return (await this.loadMany(ids)).filter(
        (r) => r.creatorWallet === wallet && r.status === "active" && (includeUnlisted || r.visibility === "public"),
      );
    });
  }

  isSlugTaken(slug: string) {
    return this.call(async () => (await this.r.get(K.slug(slug))) !== null);
  }

  updateRoom(roomId: string, actorWallet: string, patch: { title?: string; description?: string }, now: number) {
    return this.call(async () => {
      const cur = parseRoom(await this.r.get(K.room(roomId)));
      if (!cur) throw new RoomNotFoundError();
      if (cur.creatorWallet !== actorWallet) throw new RoomForbiddenError();
      const next: RoomRecord = {
        ...cur,
        title: patch.title ?? cur.title,
        description: patch.description ?? cur.description,
        updatedAt: Math.max(now, cur.updatedAt),
      };
      await this.r.set(K.room(roomId), JSON.stringify(next));
      return next;
    });
  }

  saveChallenge(c: AuthChallengeRecord) {
    return this.call(async () => {
      const ttl = Math.max(1_000, c.expiresAt - c.issuedAt + CHALLENGE_GRACE_MS);
      if (!(await this.r.setNx(K.challenge(c.nonce), JSON.stringify(c), ttl))) {
        throw new RoomStoreUnavailableError("failure", "challenge nonce collision");
      }
    });
  }

  consumeChallenge(nonce: string) {
    return this.call(async () => {
      const raw = await this.r.getdel(K.challenge(nonce));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AuthChallengeRecord;
      } catch {
        return null;
      }
    });
  }

  // ------------------------------------------------------------ forecasts (see redis-forecasts.ts)

  submitForecast(cmd: SubmitForecastCommand, idem: { key: string; fingerprint: string }) {
    return this.call(async () => {
      const room = parseRoom(await this.r.get(K.room(cmd.roomId)));
      if (!room || room.status !== "active") throw new RoomNotFoundError();
      return submitForecastRedis(this.r, ROOMS_REDIS_PREFIX, cmd, idem);
    });
  }

  getCurrentForecast(roomId: string, wallet: string) {
    return this.call(() => getCurrentForecastRedis(this.r, ROOMS_REDIS_PREFIX, roomId, wallet));
  }

  getForecastHistory(roomId: string, wallet: string, { limit }: { limit: number }) {
    return this.call(() => getForecastHistoryRedis(this.r, ROOMS_REDIS_PREFIX, roomId, wallet, limit));
  }

  listCurrentForecasts(roomId: string, { limit, offset }: { limit: number; offset: number }) {
    return this.call(() => listCurrentForecastsRedis(this.r, ROOMS_REDIS_PREFIX, roomId, limit, offset));
  }

  getForecastAggregate(roomId: string) {
    return this.call(() => getForecastAggregateRedis(this.r, ROOMS_REDIS_PREFIX, roomId));
  }

  countForecastParticipants(roomId: string) {
    return this.call(() => countForecastParticipantsRedis(this.r, ROOMS_REDIS_PREFIX, roomId));
  }

  // ------------------------------------------------------------ arena (see redis-arena.ts)

  getMarketForecastSnapshot(marketId: string) {
    return this.call(() => getMarketForecastSnapshotRedis(this.r, ROOMS_REDIS_PREFIX, marketId));
  }

  getFinalization(marketId: string) {
    return this.call(() => getFinalizationRedis(this.r, ROOMS_REDIS_PREFIX, marketId));
  }

  commitFinalization(input: CommitFinalizationInput) {
    return this.call(() => commitFinalizationRedis(this.r, ROOMS_REDIS_PREFIX, input));
  }

  listForecasters({ tier, limit, offset }: { tier: "ranked" | "provisional"; limit: number; offset: number }) {
    return this.call(() => listForecastersRedis(this.r, ROOMS_REDIS_PREFIX, tier, limit, offset));
  }

  getReputation(wallet: string) {
    return this.call(() => getReputationRedis(this.r, ROOMS_REDIS_PREFIX, wallet));
  }

  getRank(wallet: string) {
    return this.call(() => getRankRedis(this.r, ROOMS_REDIS_PREFIX, wallet));
  }

  countPendingMarkets(wallets: string[]) {
    return this.call(() => countPendingMarketsRedis(this.r, ROOMS_REDIS_PREFIX, wallets));
  }

  listGlobalScores(wallet: string, { limit, offset }: { limit: number; offset: number }) {
    return this.call(() => listGlobalScoresRedis(this.r, ROOMS_REDIS_PREFIX, wallet, limit, offset));
  }

  listRoomScores(roomId: string, { limit, offset }: { limit: number; offset: number }) {
    return this.call(() => listRoomScoresRedis(this.r, ROOMS_REDIS_PREFIX, roomId, limit, offset));
  }

  getRoomScore(roomId: string, wallet: string) {
    return this.call(() => getRoomScoreRedis(this.r, ROOMS_REDIS_PREFIX, roomId, wallet));
  }

  getGlobalScore(wallet: string, marketId: string) {
    return this.call(() => getGlobalScoreRedis(this.r, ROOMS_REDIS_PREFIX, wallet, marketId));
  }

  listWalletRooms(wallet: string, { limit }: { limit: number }) {
    return this.call(() => listWalletRoomsRedis(this.r, ROOMS_REDIS_PREFIX, wallet, limit));
  }

  listUnfinalizedMarkets({ limit }: { limit: number }) {
    return this.call(() => listUnfinalizedMarketsRedis(this.r, ROOMS_REDIS_PREFIX, limit));
  }

  noteParticipation(p: { wallet: string; roomId: string; marketId: string; at: number }) {
    return this.call(() => noteParticipationRedis(this.r, ROOMS_REDIS_PREFIX, p));
  }
}
