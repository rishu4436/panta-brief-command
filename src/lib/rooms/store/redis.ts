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
import { ChallengeLimitError, DebateNotFoundError } from "@/lib/debate/types";
import { type DebateBundle, type DebateChallenge } from "@/lib/debate/domain";
import {
  acquireDebateLockRedis,
  addChallengeRedis,
  findChallengeByIdempotencyKeyRedis,
  findDebateByIdempotencyKeyRedis,
  getDebateRedis,
  getLatestDebateRedis,
  isDebateLockedRedis,
  listChallengesRedis,
  listDebatesRedis,
  releaseDebateLockRedis,
  saveDebateRedis,
} from "./redis-debate";
import type { RoomRecord } from "../domain";
import type { CreatorActivity, RecordEventCommand } from "@/lib/studio/types";
import {
  countRoomChallengesRedis,
  getCreatorStatsRedis,
  listStudioCountersRedis,
  noteCreatorActivityRedis,
  recordStudioEventRedis,
} from "./redis-studio";
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
  type AuthSessionRecord,
  type CreateRoomResult,
  type NewRoom,
  type RoomPatch,
  type RoomRepository,
} from "./types";

export const ROOMS_REDIS_PREFIX = "pbc:rooms:v1:";
/**
 * Live-verification namespaces only (scripts/verify-upstash-live.mjs): every
 * key the adapter touches then starts with this prefix, never the production
 * one. Must look like `pbc:phase8test:<random>:`.
 */
export const ISOLATED_PREFIX_RE = /^pbc:phase8test:[a-z0-9]{8,32}:$/;
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

const keysFor = (P: string) => ({
  room: (id: string) => `${P}room:${id}`,
  slug: (slug: string) => `${P}slug:${slug}`,
  idem: (wallet: string, key: string) => `${P}idem:${wallet}:${key}`,
  publicIndex: () => `${P}public`,
  creatorIndex: (wallet: string) => `${P}creator:${wallet}`,
  challenge: (nonce: string) => `${P}challenge:${nonce}`,
  session: (sidHash: string) => `${P}session:${sidHash}`,
});

/** Compare-and-set on one room key: KEYS room; ARGV expected JSON, new JSON. 1 = written, 0 = changed underneath. */
const ROOM_CAS_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

/** Public-directory index sync: KEYS public ZSET; ARGV "add"|"rem", score, roomId. */
const PUBLIC_INDEX_SCRIPT = `
if ARGV[1] == 'add' then redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3]) else redis.call('ZREM', KEYS[1], ARGV[3]) end
return 1
`;

const ROOM_CAS_ATTEMPTS = 4;

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

  private readonly p: string;
  private readonly k: ReturnType<typeof keysFor>;

  /** `opts.isolatedPrefix` is for live verification against a real instance only (see ISOLATED_PREFIX_RE). */
  constructor(
    private readonly r: RedisLike,
    opts: { isolatedPrefix?: string } = {},
  ) {
    if (opts.isolatedPrefix !== undefined && !ISOLATED_PREFIX_RE.test(opts.isolatedPrefix)) {
      throw new Error("isolatedPrefix must match pbc:phase8test:<random>:");
    }
    this.p = opts.isolatedPrefix ?? ROOMS_REDIS_PREFIX;
    this.k = keysFor(this.p);
  }

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
        e instanceof FinalizationIntegrityError ||
        e instanceof ChallengeLimitError ||
        e instanceof DebateNotFoundError
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
    const room = parseRoom(await this.r.get(this.k.room(roomId)));
    if (!room) throw new CreateInProgressError();
    return { status: "replayed", room };
  }

  createRoom(room: NewRoom, idem: { key: string; fingerprint: string }): Promise<CreateRoomResult> {
    return this.call(async () => {
      const idemKey = this.k.idem(room.creatorWallet, idem.key);
      const prior = await this.r.get(idemKey);
      if (prior) return this.resolveIdem(prior, idem.fingerprint);

      const record: RoomRecord = { ...room, status: room.status ?? "active", updatedAt: room.createdAt };
      if (!(await this.r.setNx(idemKey, `${record.roomId}|${idem.fingerprint}`, IDEM_TTL_MS))) {
        const raced = await this.r.get(idemKey);
        if (raced) return this.resolveIdem(raced, idem.fingerprint);
        throw new CreateInProgressError();
      }
      if (!(await this.r.setNx(this.k.slug(record.slug), record.roomId))) {
        await this.r.del(idemKey).catch(() => undefined);
        throw new SlugTakenError(record.slug);
      }
      const writes: RedisWrite[] = [
        { op: "set", key: this.k.room(record.roomId), value: JSON.stringify(record) },
        { op: "zadd", key: this.k.creatorIndex(record.creatorWallet), score: record.createdAt, member: record.roomId },
      ];
      if (record.visibility === "public") {
        writes.push({ op: "zadd", key: this.k.publicIndex(), score: record.createdAt, member: record.roomId });
      }
      try {
        await this.r.multi(writes);
      } catch {
        await this.r.del(this.k.slug(record.slug)).catch(() => undefined);
        await this.r.del(idemKey).catch(() => undefined);
        throw new RoomStoreUnavailableError("failure", "room write failed; nothing was saved");
      }
      return { status: "created", room: record };
    });
  }

  getRoomById(roomId: string) {
    return this.call(async () => parseRoom(await this.r.get(this.k.room(roomId))));
  }

  getRoomBySlug(slug: string) {
    return this.call(async () => {
      const id = await this.r.get(this.k.slug(slug));
      if (!id) return null;
      const room = parseRoom(await this.r.get(this.k.room(id)));
      return room && room.slug === slug ? room : null;
    });
  }

  private async loadMany(ids: string[]): Promise<RoomRecord[]> {
    if (!ids.length) return [];
    const raws = await this.r.mget(ids.map(this.k.room));
    return raws.map(parseRoom).filter((x): x is RoomRecord => x !== null);
  }

  listPublicRooms({ limit }: { limit: number }) {
    return this.call(async () => {
      const ids = await this.r.zrevrange(this.k.publicIndex(), 0, limit - 1);
      return (await this.loadMany(ids)).filter((r) => r.visibility === "public" && r.status === "active");
    });
  }

  listRoomsByCreator(wallet: string, { limit, includeUnlisted }: { limit: number; includeUnlisted: boolean }) {
    return this.call(async () => {
      const ids = await this.r.zrevrange(this.k.creatorIndex(wallet), 0, limit - 1);
      return (await this.loadMany(ids)).filter(
        (r) => r.creatorWallet === wallet && r.status === "active" && (includeUnlisted || r.visibility === "public"),
      );
    });
  }

  isSlugTaken(slug: string) {
    return this.call(async () => (await this.r.get(this.k.slug(slug))) !== null);
  }

  /**
   * Compare-and-set on the room record (retried if another edit lands in
   * between), then the public index is synced. The record is authoritative:
   * directory reads re-check visibility + status, so a failed index sync can
   * only hide a public room until its next save, never leak an unlisted or
   * archived one.
   */
  updateRoom(roomId: string, actorWallet: string, patch: RoomPatch, now: number) {
    return this.call(async () => {
      for (let attempt = 0; attempt < ROOM_CAS_ATTEMPTS; attempt++) {
        const raw = await this.r.get(this.k.room(roomId));
        const cur = parseRoom(raw);
        if (!cur || !raw) throw new RoomNotFoundError();
        if (cur.creatorWallet !== actorWallet) throw new RoomForbiddenError();
        const next: RoomRecord = {
          ...cur,
          title: patch.title ?? cur.title,
          description: patch.description ?? cur.description,
          visibility: patch.visibility ?? cur.visibility,
          status: patch.status ?? cur.status,
          updatedAt: Math.max(now, cur.updatedAt),
        };
        if (Number(await this.r.eval(ROOM_CAS_SCRIPT, [this.k.room(roomId)], [raw, JSON.stringify(next)])) !== 1) continue;
        const listed = next.visibility === "public" && next.status === "active";
        await this.r.eval(PUBLIC_INDEX_SCRIPT, [this.k.publicIndex()], [listed ? "add" : "rem", String(next.createdAt), roomId]);
        return next;
      }
      throw new RoomStoreUnavailableError("failure", "room changed concurrently; try again");
    });
  }

  listCreatorRoomsAll(wallet: string, { limit }: { limit: number }) {
    return this.call(async () => {
      const ids = await this.r.zrevrange(this.k.creatorIndex(wallet), 0, limit - 1);
      return (await this.loadMany(ids)).filter((r) => r.creatorWallet === wallet);
    });
  }

  saveChallenge(c: AuthChallengeRecord) {
    return this.call(async () => {
      const ttl = Math.max(1_000, c.expiresAt - c.issuedAt + CHALLENGE_GRACE_MS);
      if (!(await this.r.setNx(this.k.challenge(c.nonce), JSON.stringify(c), ttl))) {
        throw new RoomStoreUnavailableError("failure", "challenge nonce collision");
      }
    });
  }

  consumeChallenge(nonce: string) {
    return this.call(async () => {
      const raw = await this.r.getdel(this.k.challenge(nonce));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AuthChallengeRecord;
      } catch {
        return null;
      }
    });
  }

  // ------------------------------------------------------------ sessions (allowlist)
  // rooms:session:<sha256(sid)> STRING {w, iat, exp}, PX = remaining lifetime.
  // Redis drops it at expiry; sign-out DELs it (idempotent).

  createSession(r: AuthSessionRecord) {
    return this.call(async () => {
      const ttl = r.expiresAt - r.issuedAt;
      if (!(ttl > 0)) throw new RoomStoreUnavailableError("failure", "session already expired");
      if (!(await this.r.setNx(this.k.session(r.sidHash), JSON.stringify({ w: r.wallet, iat: r.issuedAt, exp: r.expiresAt }), ttl))) {
        throw new RoomStoreUnavailableError("failure", "session id collision");
      }
    });
  }

  getActiveSession(sidHash: string, now: number) {
    return this.call(async () => {
      const raw = await this.r.get(this.k.session(sidHash));
      if (!raw) return null;
      try {
        const p = JSON.parse(raw) as { w?: unknown; iat?: unknown; exp?: unknown };
        if (typeof p.w !== "string" || typeof p.iat !== "number" || typeof p.exp !== "number" || p.exp <= now) return null;
        return { sidHash, wallet: p.w, issuedAt: p.iat, expiresAt: p.exp } satisfies AuthSessionRecord;
      } catch {
        return null;
      }
    });
  }

  revokeSession(sidHash: string) {
    return this.call(async () => {
      await this.r.del(this.k.session(sidHash));
    });
  }

  // ------------------------------------------------------------ forecasts (see redis-forecasts.ts)

  submitForecast(cmd: SubmitForecastCommand, idem: { key: string; fingerprint: string }) {
    return this.call(async () => {
      const room = parseRoom(await this.r.get(this.k.room(cmd.roomId)));
      if (!room || room.status !== "active") throw new RoomNotFoundError();
      return submitForecastRedis(this.r, this.p, cmd, idem);
    });
  }

  getCurrentForecast(roomId: string, wallet: string) {
    return this.call(() => getCurrentForecastRedis(this.r, this.p, roomId, wallet));
  }

  getForecastHistory(roomId: string, wallet: string, { limit }: { limit: number }) {
    return this.call(() => getForecastHistoryRedis(this.r, this.p, roomId, wallet, limit));
  }

  listCurrentForecasts(roomId: string, { limit, offset }: { limit: number; offset: number }) {
    return this.call(() => listCurrentForecastsRedis(this.r, this.p, roomId, limit, offset));
  }

  getForecastAggregate(roomId: string) {
    return this.call(() => getForecastAggregateRedis(this.r, this.p, roomId));
  }

  countForecastParticipants(roomId: string) {
    return this.call(() => countForecastParticipantsRedis(this.r, this.p, roomId));
  }

  // ------------------------------------------------------------ arena (see redis-arena.ts)

  getMarketForecastSnapshot(marketId: string) {
    return this.call(() => getMarketForecastSnapshotRedis(this.r, this.p, marketId));
  }

  getFinalization(marketId: string) {
    return this.call(() => getFinalizationRedis(this.r, this.p, marketId));
  }

  commitFinalization(input: CommitFinalizationInput) {
    return this.call(() => commitFinalizationRedis(this.r, this.p, input));
  }

  listForecasters({ tier, limit, offset }: { tier: "ranked" | "provisional"; limit: number; offset: number }) {
    return this.call(() => listForecastersRedis(this.r, this.p, tier, limit, offset));
  }

  getReputation(wallet: string) {
    return this.call(() => getReputationRedis(this.r, this.p, wallet));
  }

  getRank(wallet: string) {
    return this.call(() => getRankRedis(this.r, this.p, wallet));
  }

  countPendingMarkets(wallets: string[]) {
    return this.call(() => countPendingMarketsRedis(this.r, this.p, wallets));
  }

  listGlobalScores(wallet: string, { limit, offset }: { limit: number; offset: number }) {
    return this.call(() => listGlobalScoresRedis(this.r, this.p, wallet, limit, offset));
  }

  listRoomScores(roomId: string, { limit, offset }: { limit: number; offset: number }) {
    return this.call(() => listRoomScoresRedis(this.r, this.p, roomId, limit, offset));
  }

  getRoomScore(roomId: string, wallet: string) {
    return this.call(() => getRoomScoreRedis(this.r, this.p, roomId, wallet));
  }

  getGlobalScore(wallet: string, marketId: string) {
    return this.call(() => getGlobalScoreRedis(this.r, this.p, wallet, marketId));
  }

  listWalletRooms(wallet: string, { limit }: { limit: number }) {
    return this.call(() => listWalletRoomsRedis(this.r, this.p, wallet, limit));
  }

  listUnfinalizedMarkets({ limit }: { limit: number }) {
    return this.call(() => listUnfinalizedMarketsRedis(this.r, this.p, limit));
  }

  noteParticipation(p: { wallet: string; roomId: string; marketId: string; at: number }) {
    return this.call(() => noteParticipationRedis(this.r, this.p, p));
  }

  // ------------------------------------------------------------ Creator Growth Studio (see redis-studio.ts)
  getCreatorStats(wallet: string, opts: { rooms: RoomRecord[]; sinceMs: number; maxFirst: number }) {
    return this.call(() => getCreatorStatsRedis(this.r, this.p, wallet, opts));
  }
  noteCreatorActivity(a: CreatorActivity) {
    return this.call(() => noteCreatorActivityRedis(this.r, this.p, a));
  }
  countRoomChallenges(roomId: string) {
    return this.call(() => countRoomChallengesRedis(this.r, this.p, roomId));
  }
  recordStudioEvent(cmd: RecordEventCommand) {
    return this.call(() => recordStudioEventRedis(this.r, this.p, cmd));
  }
  listStudioCounters(wallet: string, { days }: { days: string[] }) {
    return this.call(() => listStudioCountersRedis(this.r, this.p, wallet, days));
  }

  // ------------------------------------------------------------ AI debates (see redis-debate.ts)

  saveDebate(bundle: DebateBundle, opts: { idempotencyKey: string; keepLast: number; idemTtlMs: number }) {
    return this.call(() => saveDebateRedis(this.r, this.p, this.k.room(bundle.debate.roomId), bundle, opts));
  }
  findDebateByIdempotencyKey(roomId: string, key: string) {
    return this.call(() => findDebateByIdempotencyKeyRedis(this.r, this.p, roomId, key));
  }
  getDebate(roomId: string, debateId: string) {
    return this.call(() => getDebateRedis(this.r, this.p, roomId, debateId));
  }
  getLatestDebate(roomId: string) {
    return this.call(() => getLatestDebateRedis(this.r, this.p, roomId));
  }
  listDebates(roomId: string, { limit }: { limit: number }) {
    return this.call(() => listDebatesRedis(this.r, this.p, roomId, limit));
  }
  acquireDebateLock(roomId: string, token: string, ttlMs: number) {
    return this.call(() => acquireDebateLockRedis(this.r, this.p, roomId, token, ttlMs));
  }
  releaseDebateLock(roomId: string, token: string) {
    return this.call(() => releaseDebateLockRedis(this.r, this.p, roomId, token));
  }
  isDebateLocked(roomId: string) {
    return this.call(() => isDebateLockedRedis(this.r, this.p, roomId));
  }
  addChallenge(
    roomId: string,
    challenge: DebateChallenge,
    opts: { idempotencyKey: string; fingerprint: string; maxPerClaim: number; maxPerDebate: number; idemTtlMs: number },
  ) {
    return this.call(() => addChallengeRedis(this.r, this.p, roomId, challenge, opts));
  }
  findChallengeByIdempotencyKey(roomId: string, wallet: string, key: string) {
    return this.call(() => findChallengeByIdempotencyKeyRedis(this.r, this.p, roomId, wallet, key));
  }
  listChallenges(roomId: string, debateId: string, { limit }: { limit: number }) {
    return this.call(() => listChallengesRedis(this.r, this.p, roomId, debateId, limit));
  }
}
