import "server-only";

/**
 * Creator Growth Studio on Upstash Redis. See docs/CREATOR_STUDIO.md.
 *
 * Per-creator participation indexes (one hash tag per creator, so every
 * script touches a single slot):
 *   st:{c:<wallet>}:first   ZSET  wallet → first forecast time in any of the creator's rooms
 *   st:{c:<wallet>}:pairs   SET   "wallet|roomId" (wallet has a forecast in that room)
 *   st:{c:<wallet>}:wrc     HASH  wallet → number of the creator's rooms it forecast in
 *   st:{c:<wallet>}:stats   HASH  returning (wallets with wrc ≥ 2), approximate
 *   st:{c:<wallet>}:rrev    HASH  roomId → saved revisions
 *   st:{c:<wallet>}:v       backfill marker (rrev is only incremented once it exists)
 * Maintained by NOTE_SCRIPT after each successful forecast write; the
 * set-based parts are idempotent (SADD), so the one-time backfill can merge
 * into them safely. The backfill scans existing forecasts (bounded) the first
 * time a creator opens the Studio.
 *
 * Distribution counters:
 *   ev:{c:<wallet>}:d:<YYYY-MM-DD>  HASH "<roomId>|<metric>" → count, "#fields", "<roomId>|#dyn"; PEXPIRE 90 days
 *   ev:{c:<wallet>}:dd:<hmac>       dedupe marker, SET NX PX 26 h
 */

import {
  ANALYTICS_RETENTION_DAYS,
  DEDUPE_TTL_MS,
  isDynamicMetric,
  MAX_DAY_FIELDS,
  MAX_DYNAMIC_FIELDS_PER_ROOM_DAY,
} from "@/lib/studio/domain";
import type { CounterRow, CreatorActivity, CreatorStats, RecordEventCommand, RecordEventResult } from "@/lib/studio/types";
import type { RoomRecord } from "../domain";
import type { RedisLike } from "./redis";
import { debateKeys } from "./redis-debate";
import { listCurrentForecastsRedis } from "./redis-forecasts";
import { overflowMetric } from "./sqlite-studio";

export const STUDIO_BACKFILL_VERSION = "1";
/** Forecast records scanned by the one-time backfill per creator (beyond this, stats are flagged approximate). */
export const STUDIO_BACKFILL_MAX_FORECASTS = 5000;
const BACKFILL_PAGE = 100;
const MERGE_CHUNK = 300;

export function studioKeys(prefix: string, wallet: string) {
  const st = `${prefix}st:{c:${wallet}}:`;
  const ev = `${prefix}ev:{c:${wallet}}:`;
  return {
    first: `${st}first`,
    pairs: `${st}pairs`,
    wrc: `${st}wrc`,
    stats: `${st}stats`,
    rrev: `${st}rrev`,
    v: `${st}v`,
    day: (day: string) => `${ev}d:${day}`,
    dedupe: (key: string) => `${ev}dd:${key}`,
  };
}

/** KEYS: first, pairs, wrc, stats, rrev, v. ARGV: wallet, roomId, kind, firstAt. */
const NOTE_SCRIPT = `
local w, room, kind = ARGV[1], ARGV[2], ARGV[3]
if kind == 'created' then
  if redis.call('SADD', KEYS[2], w .. '|' .. room) == 1 then
    local n = redis.call('HINCRBY', KEYS[3], w, 1)
    if n == 2 then redis.call('HINCRBY', KEYS[4], 'returning', 1) end
  end
  local s = redis.call('ZSCORE', KEYS[1], w)
  if (not s) or tonumber(ARGV[4]) < tonumber(s) then redis.call('ZADD', KEYS[1], ARGV[4], w) end
end
if redis.call('EXISTS', KEYS[6]) == 1 then redis.call('HINCRBY', KEYS[5], room, 1) end
return 1
`;

/** KEYS: first, pairs, wrc, stats. ARGV: (wallet, roomId, firstAt)*. Idempotent. */
const MERGE_SCRIPT = `
local i = 1
while i <= #ARGV do
  local w, room = ARGV[i], ARGV[i + 1]
  if redis.call('SADD', KEYS[2], w .. '|' .. room) == 1 then
    local n = redis.call('HINCRBY', KEYS[3], w, 1)
    if n == 2 then redis.call('HINCRBY', KEYS[4], 'returning', 1) end
  end
  local s = redis.call('ZSCORE', KEYS[1], w)
  if (not s) or tonumber(ARGV[i + 2]) < tonumber(s) then redis.call('ZADD', KEYS[1], ARGV[i + 2], w) end
  i = i + 3
end
return 1
`;

/** KEYS: rrev, stats, v. ARGV: version, approximate, (roomId, revisions)*. */
const FINALIZE_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
local i = 3
while i <= #ARGV do
  redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])
  i = i + 2
end
redis.call('HSET', KEYS[2], 'approximate', ARGV[2])
redis.call('SET', KEYS[3], ARGV[1])
return 1
`;

/** KEYS: first, stats, rrev, v. ARGV: sinceMs, maxFirst. */
const STATS_SCRIPT = `
local n = redis.call('ZCARD', KEYS[1])
local returning = redis.call('HGET', KEYS[2], 'returning') or '0'
local approx = redis.call('HGET', KEYS[2], 'approximate') or '0'
local rrev = redis.call('HGETALL', KEYS[3])
local firsts = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], '+inf', 'WITHSCORES', 'LIMIT', '0', ARGV[2])
local v = redis.call('GET', KEYS[4]) or ''
return {n, returning, approx, rrev, firsts, v}
`;

/**
 * KEYS: day hash, dedupe key.
 * ARGV: roomId, maxDayFields, maxDynPerRoom, dayTtlMs, dedupeTtlMs, (metric, overflowMetric|'')*.
 */
const RECORD_SCRIPT = `
if not redis.call('SET', KEYS[2], '1', 'NX', 'PX', ARGV[5]) then return 'duplicate' end
local room = ARGV[1]
local maxFields, maxDyn = tonumber(ARGV[2]), tonumber(ARGV[3])
local dynField = room .. '|#dyn'
local counted = 0
local i = 6
while i <= #ARGV do
  local over = ARGV[i + 1]
  local f = room .. '|' .. ARGV[i]
  if over ~= '' and redis.call('HEXISTS', KEYS[1], f) == 0 then
    if tonumber(redis.call('HGET', KEYS[1], dynField) or '0') >= maxDyn then
      f = room .. '|' .. over
      over = ''
    end
  end
  local isNew = redis.call('HEXISTS', KEYS[1], f) == 0
  if not (isNew and tonumber(redis.call('HGET', KEYS[1], '#fields') or '0') >= maxFields) then
    redis.call('HINCRBY', KEYS[1], f, 1)
    if isNew then
      redis.call('HINCRBY', KEYS[1], '#fields', 1)
      if over ~= '' then redis.call('HINCRBY', KEYS[1], dynField, 1) end
    end
    counted = counted + 1
  end
  i = i + 2
end
if counted > 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[4])
  return 'counted'
end
return 'capped'
`;

/** KEYS: day hashes (one creator). */
const READ_DAYS_SCRIPT = `
local out = {}
for i = 1, #KEYS do out[i] = redis.call('HGETALL', KEYS[i]) end
return out
`;

/** KEYS: challenge lists of one room's debates. */
const COUNT_LISTS_SCRIPT = `
local n = 0
for i = 1, #KEYS do n = n + redis.call('LLEN', KEYS[i]) end
return n
`;

/** day, then roomId, then metric (byte order), the same order SQLite returns. */
export function compareCounterRows(a: CounterRow, b: CounterRow): number {
  const ka = [a.day, a.roomId, a.metric];
  const kb = [b.day, b.roomId, b.metric];
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pairsOf = (v: unknown): [string, string][] => {
  const a = arr(v);
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push([String(a[i]), String(a[i + 1])]);
  return out;
};

export async function noteCreatorActivityRedis(r: RedisLike, prefix: string, a: CreatorActivity): Promise<void> {
  const k = studioKeys(prefix, a.creatorWallet);
  await r.eval(NOTE_SCRIPT, [k.first, k.pairs, k.wrc, k.stats, k.rrev, k.v], [a.wallet, a.roomId, a.kind, String(a.firstAt)]);
}

async function backfill(r: RedisLike, prefix: string, wallet: string, rooms: RoomRecord[]): Promise<void> {
  const k = studioKeys(prefix, wallet);
  const triples: string[] = [];
  const revs: Record<string, number> = {};
  let scanned = 0;
  let approximate = false;
  outer: for (const room of rooms) {
    if (room.creatorWallet !== wallet) continue;
    for (let offset = 0; ; offset += BACKFILL_PAGE) {
      const page = await listCurrentForecastsRedis(r, prefix, room.roomId, BACKFILL_PAGE, offset);
      for (const f of page.items) {
        if (scanned >= STUDIO_BACKFILL_MAX_FORECASTS) {
          approximate = true;
          break outer;
        }
        scanned += 1;
        triples.push(f.wallet, room.roomId, String(f.createdAt));
        revs[room.roomId] = (revs[room.roomId] ?? 0) + f.revision;
      }
      if (page.items.length < BACKFILL_PAGE || offset + BACKFILL_PAGE >= page.total) break;
    }
  }
  for (let i = 0; i < triples.length; i += MERGE_CHUNK * 3) {
    await r.eval(MERGE_SCRIPT, [k.first, k.pairs, k.wrc, k.stats], triples.slice(i, i + MERGE_CHUNK * 3));
  }
  const args = [STUDIO_BACKFILL_VERSION, approximate ? "1" : "0"];
  for (const [roomId, n] of Object.entries(revs)) args.push(roomId, String(n));
  await r.eval(FINALIZE_SCRIPT, [k.rrev, k.stats, k.v], args);
}

export async function getCreatorStatsRedis(
  r: RedisLike,
  prefix: string,
  wallet: string,
  opts: { rooms: RoomRecord[]; sinceMs: number; maxFirst: number },
): Promise<CreatorStats> {
  const k = studioKeys(prefix, wallet);
  const read = async () => arr(await r.eval(STATS_SCRIPT, [k.first, k.stats, k.rrev, k.v], [String(opts.sinceMs), String(opts.maxFirst)]));
  let res = await read();
  if (String(res[5] ?? "") === "") {
    await backfill(r, prefix, wallet, opts.rooms);
    res = await read();
  }
  const revisionsByRoom: Record<string, number> = {};
  for (const [roomId, n] of pairsOf(res[3])) revisionsByRoom[roomId] = Number(n) || 0;
  const firstForecastTimes = pairsOf(res[4]).map(([, score]) => Number(score));
  return {
    uniqueForecasters: Number(res[0]) || 0,
    returningForecasters: Number(res[1]) || 0,
    revisionsByRoom,
    firstForecastTimes,
    approximate: String(res[2]) === "1",
  };
}

export async function countRoomChallengesRedis(r: RedisLike, prefix: string, roomId: string): Promise<number> {
  const k = debateKeys(prefix, roomId);
  const ids = await r.zrevrange(k.idx, 0, -1);
  if (!ids.length) return 0;
  return Number(await r.eval(COUNT_LISTS_SCRIPT, ids.map((id) => k.challenges(id)), [])) || 0;
}

export async function recordStudioEventRedis(r: RedisLike, prefix: string, cmd: RecordEventCommand): Promise<RecordEventResult> {
  const k = studioKeys(prefix, cmd.creatorWallet);
  const args = [cmd.roomId, String(MAX_DAY_FIELDS), String(MAX_DYNAMIC_FIELDS_PER_ROOM_DAY), String((ANALYTICS_RETENTION_DAYS + 1) * 86_400_000), String(DEDUPE_TTL_MS)];
  for (const m of cmd.metrics) args.push(m, isDynamicMetric(m) ? overflowMetric(m) : "");
  const out = String(await r.eval(RECORD_SCRIPT, [k.day(cmd.day), k.dedupe(cmd.dedupeKey)], args));
  return out === "duplicate" || out === "capped" ? out : "counted";
}

export async function listStudioCountersRedis(r: RedisLike, prefix: string, wallet: string, days: string[]): Promise<CounterRow[]> {
  if (!days.length) return [];
  const k = studioKeys(prefix, wallet);
  const res = arr(await r.eval(READ_DAYS_SCRIPT, days.map(k.day), []));
  const out: CounterRow[] = [];
  days.forEach((day, i) => {
    for (const [field, n] of pairsOf(res[i])) {
      const sep = field.indexOf("|");
      if (sep <= 0) continue; // "#fields"
      const metric = field.slice(sep + 1);
      if (metric.startsWith("#")) continue; // "<room>|#dyn"
      out.push({ day, roomId: field.slice(0, sep), metric, count: Number(n) || 0 });
    }
  });
  return out.sort(compareCounterRows);
}
