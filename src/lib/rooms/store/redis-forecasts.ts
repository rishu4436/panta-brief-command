import "server-only";

/**
 * Forecast operations for the Upstash Redis room repository.
 *
 * Keys (all for one room share the {roomId} hash tag, so the Lua script only
 * touches one slot):
 *   fc:{roomId}:meta    HASH  wallet → "<revision>|<bps>"   (what the script checks)
 *   fc:{roomId}:cur     HASH  wallet → current forecast JSON
 *   fc:{roomId}:hist:<wallet>  LIST  revision JSON, appended only (RPUSH)
 *   fc:{roomId}:agg     HASH  count, sum, b0..b9         (CURRENT forecasts only)
 *   fc:{roomId}:order   ZSET  wallet → updatedAt         (public listing)
 *   fc:{roomId}:idem:<wallet>:<key>  STRING "<fingerprint>|<result JSON>" (24 h)
 *
 * SUBMIT_SCRIPT runs atomically in Redis: it re-checks the idempotency key,
 * compares the stored revision with expectedRevision (lost-update guard),
 * checks the history length matches, then appends history, replaces the
 * current record, adjusts the aggregate counters and records the idempotency
 * result, all in one step. Nothing falls back to memory on failure.
 */

import { bucketOf, emptyAggregate, type ForecastAggregate, type ForecastRecord, type ForecastRevisionRecord } from "@/lib/forecasts/domain";
import { ForecastRevisionConflictError, type SubmitForecastCommand, type SubmitForecastResult } from "@/lib/forecasts/types";
import { IdempotencyConflictError, RoomStoreUnavailableError } from "./types";

export const FORECAST_IDEM_TTL_MS = 24 * 3600_000;

export function forecastKeys(prefix: string, roomId: string) {
  const base = `${prefix}fc:{${roomId}}:`;
  return {
    meta: `${base}meta`,
    cur: `${base}cur`,
    hist: (wallet: string) => `${base}hist:${wallet}`,
    agg: `${base}agg`,
    order: `${base}order`,
    idem: (wallet: string, key: string) => `${base}idem:${wallet}:${key}`,
  };
}

/**
 * KEYS: 1 meta, 2 cur, 3 hist, 4 agg, 5 order, 6 idem
 * ARGV: 1 wallet, 2 expectedRevision, 3 bps, 4 current JSON, 5 revision JSON,
 *       6 updatedAt ms, 7 idempotency value, 8 idempotency TTL ms
 * Returns {"IDEM", value} | {"CONFLICT", currentRevision} | {"CORRUPT", currentRevision} | {"OK", newRevision}
 */
export const SUBMIT_SCRIPT = `
local prior = redis.call('GET', KEYS[6])
if prior then return {'IDEM', prior} end
local meta = redis.call('HGET', KEYS[1], ARGV[1])
local rev = 0
local oldBps = -1
if meta then
  local r, b = string.match(meta, '^(%d+)|(%d+)$')
  if not r then return {'CORRUPT', '-1'} end
  rev = tonumber(r)
  oldBps = tonumber(b)
end
if rev ~= tonumber(ARGV[2]) then return {'CONFLICT', tostring(rev)} end
if redis.call('LLEN', KEYS[3]) ~= rev then return {'CORRUPT', tostring(rev)} end
local bps = tonumber(ARGV[3])
local newRev = rev + 1
local function bucket(v)
  local k = math.floor(v / 1000)
  if k > 9 then k = 9 end
  return 'b' .. k
end
redis.call('RPUSH', KEYS[3], ARGV[5])
redis.call('HSET', KEYS[1], ARGV[1], newRev .. '|' .. bps)
redis.call('HSET', KEYS[2], ARGV[1], ARGV[4])
redis.call('ZADD', KEYS[5], ARGV[6], ARGV[1])
if oldBps >= 0 then
  redis.call('HINCRBY', KEYS[4], 'sum', bps - oldBps)
  redis.call('HINCRBY', KEYS[4], bucket(oldBps), -1)
else
  redis.call('HINCRBY', KEYS[4], 'sum', bps)
  redis.call('HINCRBY', KEYS[4], 'count', 1)
end
redis.call('HINCRBY', KEYS[4], bucket(bps), 1)
redis.call('SET', KEYS[6], ARGV[7], 'PX', ARGV[8])
return {'OK', tostring(newRev)}
`;

/** The commands forecasts need on top of the room ones. */
export interface RedisForecastOps {
  hget(key: string, field: string): Promise<string | null>;
  hmget(key: string, fields: string[]): Promise<(string | null)[]>;
  hgetall(key: string): Promise<Record<string, string>>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  get(key: string): Promise<string | null>;
  /** EVAL script; returns the script's reply (array of strings here). */
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

function parseForecast(raw: string | null | undefined): ForecastRecord | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as ForecastRecord;
    return typeof f?.forecastId === "string" && typeof f.revision === "number" ? f : null;
  } catch {
    return null;
  }
}

function parseRevision(raw: string): ForecastRevisionRecord | null {
  try {
    const r = JSON.parse(raw) as ForecastRevisionRecord;
    return typeof r?.revision === "number" ? r : null;
  } catch {
    return null;
  }
}

function replayFrom(value: string, fingerprint: string): SubmitForecastResult {
  const sep = value.indexOf("|");
  if (sep <= 0 || value.slice(0, sep) !== fingerprint) throw new IdempotencyConflictError();
  const forecast = parseForecast(value.slice(sep + 1));
  if (!forecast) throw new RoomStoreUnavailableError("failure", "unreadable forecast idempotency record");
  return { status: "replayed", forecast };
}

export async function submitForecastRedis(
  r: RedisForecastOps,
  prefix: string,
  cmd: SubmitForecastCommand,
  idem: { key: string; fingerprint: string },
): Promise<SubmitForecastResult> {
  const k = forecastKeys(prefix, cmd.roomId);
  const idemKey = k.idem(cmd.wallet, idem.key);
  const prior = await r.get(idemKey);
  if (prior) return replayFrom(prior, idem.fingerprint);

  // Read the current record to build the next one; the script re-checks the
  // revision atomically, so a concurrent change turns into a conflict.
  const cur = parseForecast(await r.hget(k.cur, cmd.wallet));
  const currentRevision = cur?.revision ?? 0;
  if (cmd.expectedRevision !== currentRevision) throw new ForecastRevisionConflictError(currentRevision);
  const next: ForecastRecord = cur
    ? { ...cur, probabilityBps: cmd.probabilityBps, reasoning: cmd.reasoning, revision: cur.revision + 1, updatedAt: Math.max(cmd.now, cur.updatedAt) }
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
  const revision: ForecastRevisionRecord = {
    forecastId: next.forecastId,
    roomId: next.roomId,
    wallet: next.wallet,
    revision: next.revision,
    probabilityBps: next.probabilityBps,
    reasoning: next.reasoning,
    createdAt: next.updatedAt,
  };
  const reply = await r.eval(
    SUBMIT_SCRIPT,
    [k.meta, k.cur, k.hist(cmd.wallet), k.agg, k.order, idemKey],
    [
      cmd.wallet,
      String(cmd.expectedRevision),
      String(cmd.probabilityBps),
      JSON.stringify(next),
      JSON.stringify(revision),
      String(next.updatedAt),
      `${idem.fingerprint}|${JSON.stringify(next)}`,
      String(FORECAST_IDEM_TTL_MS),
    ],
  );
  const [tag, val] = Array.isArray(reply) ? reply.map((x) => String(x)) : [];
  if (tag === "OK" && Number(val) === next.revision) return { status: cur ? "revised" : "created", forecast: next };
  if (tag === "IDEM" && val) return replayFrom(val, idem.fingerprint);
  if (tag === "CONFLICT") throw new ForecastRevisionConflictError(Number(val));
  throw new RoomStoreUnavailableError("failure", `forecast write rejected (${tag ?? "no reply"})`);
}

export async function getCurrentForecastRedis(r: RedisForecastOps, prefix: string, roomId: string, wallet: string) {
  return parseForecast(await r.hget(forecastKeys(prefix, roomId).cur, wallet));
}

export async function getForecastHistoryRedis(r: RedisForecastOps, prefix: string, roomId: string, wallet: string, limit: number) {
  const raws = await r.lrange(forecastKeys(prefix, roomId).hist(wallet), -limit, -1);
  return raws
    .map(parseRevision)
    .filter((x): x is ForecastRevisionRecord => x !== null)
    .reverse();
}

export async function listCurrentForecastsRedis(r: RedisForecastOps, prefix: string, roomId: string, limit: number, offset: number) {
  const k = forecastKeys(prefix, roomId);
  const [wallets, total] = await Promise.all([r.zrevrange(k.order, offset, offset + limit - 1), r.zcard(k.order)]);
  if (!wallets.length) return { items: [], total };
  const raws = await r.hmget(k.cur, wallets);
  return { items: raws.map(parseForecast).filter((x): x is ForecastRecord => x !== null), total };
}

export async function getForecastAggregateRedis(r: RedisForecastOps, prefix: string, roomId: string): Promise<ForecastAggregate> {
  const h = await r.hgetall(forecastKeys(prefix, roomId).agg);
  const agg = emptyAggregate();
  agg.participants = Math.max(0, Number(h.count ?? 0) || 0);
  agg.sumBps = Number(h.sum ?? 0) || 0;
  agg.buckets = agg.buckets.map((_, i) => Math.max(0, Number(h[`b${i}`] ?? 0) || 0));
  return agg;
}

export async function countForecastParticipantsRedis(r: RedisForecastOps, prefix: string, roomId: string) {
  return (await getForecastAggregateRedis(r, prefix, roomId)).participants;
}

/** Exposed for tests: the bucket the script uses must match the domain's. */
export const scriptBucketMatchesDomain = (bps: number) => Math.min(9, Math.floor(bps / 1000)) === bucketOf(bps);
