import "server-only";

/**
 * AI Debate Arena operations for the Upstash Redis room repository.
 *
 * Keys (all for one room share the {roomId} hash tag, so every script stays
 * in one slot even where it derives a key from a debate id):
 *   dbt:{roomId}:idx            ZSET  debateId → createdAt (newest K kept)
 *   dbt:{roomId}:d:<debateId>   STRING validated bundle JSON (debate + claims + evidence)
 *   dbt:{roomId}:lock           STRING generation lock token (SET NX PX)
 *   dbt:{roomId}:idem:<key>     STRING debateId (24 h)
 *   dbt:{roomId}:ch:<debateId>  LIST  challenge JSON, append-only (RPUSH)
 *   dbt:{roomId}:chn:<debateId> HASH  claimId → count, _total → count
 *   dbt:{roomId}:chidem:<wallet>:<key> STRING "<fingerprint>|<challenge JSON>" (24 h)
 *
 * SAVE_DEBATE_SCRIPT and ADD_CHALLENGE_SCRIPT run atomically. Retention is
 * part of the save: the oldest debates beyond K are removed together with
 * their challenge list and counters. The trimmed keys are derived inside the
 * script from ARGV's base (same hash tag), which Upstash accepts; on a Redis
 * Cluster that requires declared keys, the base keeps them in one slot.
 */

import { DebateBundleSchema, DebateChallengeSchema, type DebateBundle, type DebateChallenge, type DebateSummary } from "@/lib/debate/domain";
import { ChallengeLimitError, DebateNotFoundError, type AddChallengeResult, type SaveDebateResult } from "@/lib/debate/types";
import type { RedisLike } from "./redis";
import { IdempotencyConflictError, RoomNotFoundError, RoomStoreUnavailableError } from "./types";

export function debateKeys(prefix: string, roomId: string) {
  const base = `${prefix}dbt:{${roomId}}:`;
  return {
    base,
    idx: `${base}idx`,
    debate: (id: string) => `${base}d:${id}`,
    lock: `${base}lock`,
    idem: (key: string) => `${base}idem:${key}`,
    challenges: (debateId: string) => `${base}ch:${debateId}`,
    counts: (debateId: string) => `${base}chn:${debateId}`,
    chIdem: (wallet: string, key: string) => `${base}chidem:${wallet}:${key}`,
  };
}

/**
 * KEYS: 1 idx, 2 debate, 3 idem, 4 room record
 * ARGV: 1 debateId, 2 createdAt, 3 bundle JSON, 4 idem TTL ms, 5 keepLast, 6 base
 * Returns {"IDEM", debateId} | {"EXISTS", debateId} | {"NOROOM", ""} | {"OK", debateId}
 * NOROOM also when the room isn't active (archived while the debate was generating).
 */
export const SAVE_DEBATE_SCRIPT = `
local prior = redis.call('GET', KEYS[3])
if prior then return {'IDEM', prior} end
if redis.call('EXISTS', KEYS[2]) == 1 then return {'EXISTS', ARGV[1]} end
local room = redis.call('GET', KEYS[4])
if not room then return {'NOROOM', ''} end
if not string.find(room, '"status":"active"', 1, true) then return {'NOROOM', ''} end
redis.call('SET', KEYS[2], ARGV[3])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('SET', KEYS[3], ARGV[1], 'PX', ARGV[4])
local keep = tonumber(ARGV[5])
local n = redis.call('ZCARD', KEYS[1])
if n > keep then
  local old = redis.call('ZRANGE', KEYS[1], 0, n - keep - 1)
  for _, id in ipairs(old) do
    redis.call('DEL', ARGV[6] .. 'd:' .. id, ARGV[6] .. 'ch:' .. id, ARGV[6] .. 'chn:' .. id)
    redis.call('ZREM', KEYS[1], id)
  end
end
return {'OK', ARGV[1]}
`;

/**
 * KEYS: 1 debate, 2 challenge list, 3 counts, 4 chidem, 5 room record (optional)
 * ARGV: 1 claimId, 2 fingerprint, 3 challenge JSON, 4 maxPerClaim, 5 maxPerDebate, 6 idem TTL ms
 * Returns {"IDEM", "<fp>|<json>"} | {"NODEBATE", ""} | {"NOROOM", ""} | {"CLAIM_LIMIT", ""} | {"DEBATE_LIMIT", ""} | {"OK", ""}
 * NOROOM when the room was archived (or removed) while the challenge was being answered.
 */
export const ADD_CHALLENGE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'NODEBATE', ''} end
local prior = redis.call('GET', KEYS[4])
if prior then return {'IDEM', prior} end
if KEYS[5] then
  local room = redis.call('GET', KEYS[5])
  if (not room) or (not string.find(room, '"status":"active"', 1, true)) then return {'NOROOM', ''} end
end
local perClaim = tonumber(redis.call('HGET', KEYS[3], ARGV[1]) or '0')
if perClaim >= tonumber(ARGV[4]) then return {'CLAIM_LIMIT', ''} end
local total = tonumber(redis.call('HGET', KEYS[3], '_total') or '0')
if total >= tonumber(ARGV[5]) then return {'DEBATE_LIMIT', ''} end
redis.call('RPUSH', KEYS[2], ARGV[3])
redis.call('HINCRBY', KEYS[3], ARGV[1], 1)
redis.call('HINCRBY', KEYS[3], '_total', 1)
redis.call('SET', KEYS[4], ARGV[2] .. '|' .. ARGV[3], 'PX', ARGV[6])
return {'OK', ''}
`;

/** KEYS: 1 lock. ARGV: 1 token. Deletes only if the caller still holds it. */
export const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) return 1 end
return 0
`;

function parseBundle(raw: string | null): DebateBundle | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new RoomStoreUnavailableError("failure", "stored debate is not JSON");
  }
  const r = DebateBundleSchema.safeParse(json);
  if (!r.success) throw new RoomStoreUnavailableError("failure", "stored debate failed validation");
  return r.data;
}
function parseChallenge(raw: string): DebateChallenge {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new RoomStoreUnavailableError("failure", "stored challenge is not JSON");
  }
  const r = DebateChallengeSchema.safeParse(json);
  if (!r.success) throw new RoomStoreUnavailableError("failure", "stored challenge failed validation");
  return r.data;
}
function splitIdem(v: string): { fingerprint: string; challenge: DebateChallenge } {
  const i = v.indexOf("|");
  if (i < 0) throw new RoomStoreUnavailableError("failure", "corrupt challenge idempotency record");
  return { fingerprint: v.slice(0, i), challenge: parseChallenge(v.slice(i + 1)) };
}
function reply(raw: unknown): [string, string] {
  if (!Array.isArray(raw) || raw.length < 2) throw new RoomStoreUnavailableError("failure", "unexpected script reply");
  return [String(raw[0]), String(raw[1] ?? "")];
}

export async function saveDebateRedis(
  r: RedisLike,
  prefix: string,
  roomKey: string,
  bundle: DebateBundle,
  opts: { idempotencyKey: string; keepLast: number; idemTtlMs: number },
): Promise<SaveDebateResult> {
  if (!DebateBundleSchema.safeParse(bundle).success) throw new RoomStoreUnavailableError("failure", "refusing to store an invalid debate");
  const d = bundle.debate;
  const k = debateKeys(prefix, d.roomId);
  const [tag, val] = reply(
    await r.eval(SAVE_DEBATE_SCRIPT, [k.idx, k.debate(d.debateId), k.idem(opts.idempotencyKey), roomKey], [
      d.debateId,
      String(d.createdAt),
      JSON.stringify(bundle),
      String(opts.idemTtlMs),
      String(Math.max(1, opts.keepLast)),
      k.base,
    ]),
  );
  if (tag === "OK") return { status: "created", debateId: val };
  if (tag === "IDEM" || tag === "EXISTS") return { status: "replayed", debateId: val };
  if (tag === "NOROOM") throw new RoomNotFoundError();
  throw new RoomStoreUnavailableError("failure", `unexpected save reply ${tag}`);
}

export async function findDebateByIdempotencyKeyRedis(r: RedisLike, prefix: string, roomId: string, key: string) {
  return r.get(debateKeys(prefix, roomId).idem(key));
}

export async function getDebateRedis(r: RedisLike, prefix: string, roomId: string, debateId: string) {
  const b = parseBundle(await r.get(debateKeys(prefix, roomId).debate(debateId)));
  return b && b.debate.roomId === roomId ? b : null;
}

export async function getLatestDebateRedis(r: RedisLike, prefix: string, roomId: string) {
  const k = debateKeys(prefix, roomId);
  const [id] = await r.zrevrange(k.idx, 0, 0);
  return id ? getDebateRedis(r, prefix, roomId, id) : null;
}

export async function listDebatesRedis(r: RedisLike, prefix: string, roomId: string, limit: number): Promise<DebateSummary[]> {
  const k = debateKeys(prefix, roomId);
  const ids = await r.zrevrange(k.idx, 0, Math.max(0, limit - 1));
  if (!ids.length) return [];
  const raws = await r.mget(ids.map((id) => k.debate(id)));
  const out: DebateSummary[] = [];
  for (const raw of raws) {
    const b = parseBundle(raw);
    if (b) {
      const d = b.debate;
      out.push({ debateId: d.debateId, createdAt: d.createdAt, expiresAt: d.expiresAt, status: d.status, generationVersion: d.generationVersion });
    }
  }
  return out;
}

export async function acquireDebateLockRedis(r: RedisLike, prefix: string, roomId: string, token: string, ttlMs: number) {
  return r.setNx(debateKeys(prefix, roomId).lock, token, ttlMs);
}

export async function releaseDebateLockRedis(r: RedisLike, prefix: string, roomId: string, token: string) {
  await r.eval(RELEASE_LOCK_SCRIPT, [debateKeys(prefix, roomId).lock], [token]);
}

export async function isDebateLockedRedis(r: RedisLike, prefix: string, roomId: string) {
  return (await r.get(debateKeys(prefix, roomId).lock)) !== null;
}

export async function addChallengeRedis(
  r: RedisLike,
  prefix: string,
  roomId: string,
  ch: DebateChallenge,
  opts: { idempotencyKey: string; fingerprint: string; maxPerClaim: number; maxPerDebate: number; idemTtlMs: number },
): Promise<AddChallengeResult> {
  if (!DebateChallengeSchema.safeParse(ch).success) throw new RoomStoreUnavailableError("failure", "refusing to store an invalid challenge");
  const k = debateKeys(prefix, roomId);
  const [tag, val] = reply(
    await r.eval(ADD_CHALLENGE_SCRIPT, [k.debate(ch.debateId), k.challenges(ch.debateId), k.counts(ch.debateId), k.chIdem(ch.wallet, opts.idempotencyKey), `${prefix}room:${roomId}`], [
      ch.claimId,
      opts.fingerprint,
      JSON.stringify(ch),
      String(opts.maxPerClaim),
      String(opts.maxPerDebate),
      String(opts.idemTtlMs),
    ]),
  );
  if (tag === "OK") return { status: "created", challenge: ch };
  if (tag === "IDEM") {
    const prior = splitIdem(val);
    if (prior.fingerprint !== opts.fingerprint) throw new IdempotencyConflictError();
    return { status: "replayed", challenge: prior.challenge };
  }
  if (tag === "NODEBATE") throw new DebateNotFoundError();
  if (tag === "NOROOM") throw new RoomNotFoundError();
  if (tag === "CLAIM_LIMIT") throw new ChallengeLimitError("claim");
  if (tag === "DEBATE_LIMIT") throw new ChallengeLimitError("debate");
  throw new RoomStoreUnavailableError("failure", `unexpected challenge reply ${tag}`);
}

export async function findChallengeByIdempotencyKeyRedis(r: RedisLike, prefix: string, roomId: string, wallet: string, key: string) {
  const k = debateKeys(prefix, roomId);
  const v = await r.get(k.chIdem(wallet, key));
  if (!v) return null;
  const prior = splitIdem(v);
  // Parity with SQLite: a challenge whose debate was removed by retention is gone.
  if ((await r.get(k.debate(prior.challenge.debateId))) === null) return null;
  return prior;
}

export async function listChallengesRedis(r: RedisLike, prefix: string, roomId: string, debateId: string, limit: number) {
  const raws = await r.lrange(debateKeys(prefix, roomId).challenges(debateId), 0, Math.max(0, limit - 1));
  return raws.map(parseChallenge);
}
