import "server-only";

/**
 * Arena operations for the Upstash Redis room repository.
 *
 * Keys (one hash tag, {arena}, so the finalization script touches one slot):
 *   arena:{arena}:final            HASH  marketId → finalization JSON (never overwritten)
 *   arena:{arena}:score            HASH  "<roomId>|<wallet>" → room score JSON
 *   arena:{arena}:global           HASH  "<wallet>|<marketId>" → global score JSON
 *   arena:{arena}:rep              HASH  wallet → reputation JSON (maintained aggregate)
 *   arena:{arena}:rank:ranked      ZSET  score 0, member = rankKey (lex order = ranking)
 *   arena:{arena}:rank:provisional ZSET  same, below the minimum sample
 *   arena:{arena}:rscore:<roomId>  ZSET  score brierE8, member "<firstAt 15d>|<wallet>"
 *   arena:{arena}:wglobal:<wallet> ZSET  score finalizedAt, member marketId
 *   arena:{arena}:pending:<wallet> SET   marketIds forecast on, not yet scored
 *   arena:{arena}:wrooms:<wallet>  ZSET  score first forecast time, member roomId
 *   arena:{arena}:mrooms:<market>  ZSET  rooms with forecasts on the market
 *   arena:{arena}:markets          ZSET  markets with forecasts (first participation)
 *
 * FINALIZE_SCRIPT writes a finalization, all its score records, reputation
 * aggregates and ranking/index entries atomically, only if the market has no
 * finalization yet and every reputation is still the value the caller read
 * (optimistic check → "STALE" → the caller re-reads and retries). Score
 * fields that already exist abort the script ("DUP"): records are immutable.
 */

import { nextReputation, reputationView, walletFromRankKey, type GlobalScoreRecord, type MarketForecastSnapshot, type ReputationRecord, type ScoreRecord, type SnapshotRoom } from "@/lib/arena/scoring";
import { FinalizationIntegrityError, validateCommit, type CommitFinalizationInput, type CommitFinalizationResult, type FinalizationRecord, type Page, type WalletRoom } from "@/lib/arena/types";
import type { ForecastRecord, ForecastRevisionRecord } from "@/lib/forecasts/domain";
import { forecastKeys } from "./redis-forecasts";
import { RoomStoreUnavailableError } from "./types";

export function arenaKeys(prefix: string) {
  const b = `${prefix}arena:{arena}:`;
  return {
    final: `${b}final`,
    score: `${b}score`,
    global: `${b}global`,
    rep: `${b}rep`,
    ranked: `${b}rank:ranked`,
    provisional: `${b}rank:provisional`,
    rscore: (roomId: string) => `${b}rscore:${roomId}`,
    wglobal: (wallet: string) => `${b}wglobal:${wallet}`,
    pending: (wallet: string) => `${b}pending:${wallet}`,
    wrooms: (wallet: string) => `${b}wrooms:${wallet}`,
    mrooms: (marketId: string) => `${b}mrooms:${marketId}`,
    markets: `${b}markets`,
  };
}

/**
 * KEYS: 1 final, 2 rep, 3 ranked, 4 provisional, 5 score, 6 global, 7.. dynamic
 * ARGV: 1 marketId, 2 finalization JSON, 3 nScores, 4 nGlobal, 5 nRep, then
 *   per score  (5): field, JSON, zscore, zmember, rscore key index
 *   per global (6): field, JSON, wglobal key index, zscore, member(marketId), pending key index
 *   per rep    (6): wallet, expected JSON ('' = none), new JSON, old rank member ('' = none), new member, tier ('R'|'P')
 *   then nPending, then that many pending-set key indexes (every participant
 *   of a scored market, scored or not: the market is no longer pending)
 * Returns {'OK'} | {'EXISTS', json} | {'STALE', wallet} | {'DUP', field}
 */
export const FINALIZE_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
if existing then return {'EXISTS', existing} end
local nS = tonumber(ARGV[3])
local nG = tonumber(ARGV[4])
local nR = tonumber(ARGV[5])
local sBase = 6
local gBase = sBase + nS * 5
local rBase = gBase + nG * 6
for i = 0, nR - 1 do
  local b = rBase + i * 6
  local cur = redis.call('HGET', KEYS[2], ARGV[b])
  if (cur or '') ~= ARGV[b + 1] then return {'STALE', ARGV[b]} end
end
for i = 0, nS - 1 do
  local b = sBase + i * 5
  if redis.call('HEXISTS', KEYS[5], ARGV[b]) == 1 then return {'DUP', ARGV[b]} end
end
for i = 0, nG - 1 do
  local b = gBase + i * 6
  if redis.call('HEXISTS', KEYS[6], ARGV[b]) == 1 then return {'DUP', ARGV[b]} end
end
for i = 0, nS - 1 do
  local b = sBase + i * 5
  redis.call('HSET', KEYS[5], ARGV[b], ARGV[b + 1])
  redis.call('ZADD', KEYS[tonumber(ARGV[b + 4])], ARGV[b + 2], ARGV[b + 3])
end
for i = 0, nG - 1 do
  local b = gBase + i * 6
  redis.call('HSET', KEYS[6], ARGV[b], ARGV[b + 1])
  redis.call('ZADD', KEYS[tonumber(ARGV[b + 2])], ARGV[b + 3], ARGV[b + 4])
  redis.call('SREM', KEYS[tonumber(ARGV[b + 5])], ARGV[1])
end
for i = 0, nR - 1 do
  local b = rBase + i * 6
  redis.call('HSET', KEYS[2], ARGV[b], ARGV[b + 2])
  if ARGV[b + 3] ~= '' then
    redis.call('ZREM', KEYS[3], ARGV[b + 3])
    redis.call('ZREM', KEYS[4], ARGV[b + 3])
  end
  if ARGV[b + 5] == 'R' then
    redis.call('ZADD', KEYS[3], 0, ARGV[b + 4])
  else
    redis.call('ZADD', KEYS[4], 0, ARGV[b + 4])
  end
end
local pBase = rBase + nR * 6
local nP = tonumber(ARGV[pBase] or '0')
for j = 1, nP do
  redis.call('SREM', KEYS[tonumber(ARGV[pBase + j])], ARGV[1])
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return {'OK'}
`;

/** SCARD for several pending sets in one round trip. */
export const PENDING_SCRIPT = `
local out = {}
for i = 1, #KEYS do out[i] = redis.call('SCARD', KEYS[i]) end
return out
`;

/** Pre-write participation indexes (all {arena}-tagged). */
export const PARTICIPATION_SCRIPT = `
redis.call('ZADD', KEYS[1], 'NX', ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[2], 'NX', ARGV[1], ARGV[3])
redis.call('ZADD', KEYS[3], 'NX', ARGV[1], ARGV[2])
redis.call('SADD', KEYS[4], ARGV[3])
return 1
`;

export interface RedisArenaOps {
  get(key: string): Promise<string | null>;
  hget(key: string, field: string): Promise<string | null>;
  hmget(key: string, fields: string[]): Promise<(string | null)[]>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  /** Members by index, lowest score first (ties: member byte order). */
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrank(key: string, member: string): Promise<number | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const pad15 = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(15, "0");
const parse = <T,>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const ROOM_KEY = (prefix: string, id: string) => `${prefix}room:${id}`;

export async function noteParticipationRedis(r: RedisArenaOps, prefix: string, p: { wallet: string; roomId: string; marketId: string; at: number }) {
  const k = arenaKeys(prefix);
  const reply = await r.eval(PARTICIPATION_SCRIPT, [k.mrooms(p.marketId), k.markets, k.wrooms(p.wallet), k.pending(p.wallet)], [String(p.at), p.roomId, p.marketId]);
  if (Number(reply) !== 1) throw new RoomStoreUnavailableError("failure", "participation index write failed");
}

export async function getMarketForecastSnapshotRedis(r: RedisArenaOps, prefix: string, marketId: string): Promise<MarketForecastSnapshot> {
  const k = arenaKeys(prefix);
  const roomIds = await r.zrange(k.mrooms(marketId), 0, -1);
  const rooms: SnapshotRoom[] = [];
  for (const roomId of roomIds) {
    const room = parse<{ roomId: string; marketId: string }>(await r.get(ROOM_KEY(prefix, roomId)));
    if (!room || room.marketId !== marketId) continue;
    const fk = forecastKeys(prefix, roomId);
    const wallets = await r.zrange(fk.order, 0, -1);
    const curs = wallets.length ? await r.hmget(fk.cur, wallets) : [];
    const forecasters: SnapshotRoom["forecasters"] = [];
    for (let i = 0; i < wallets.length; i++) {
      const cur = parse<ForecastRecord>(curs[i]);
      if (!cur) continue;
      const hist = (await r.lrange(fk.hist(wallets[i]), 0, -1)).map((x) => parse<ForecastRevisionRecord>(x)).filter((x): x is ForecastRevisionRecord => x !== null);
      forecasters.push({
        wallet: wallets[i],
        forecastId: cur.forecastId,
        revisions: hist.map((h) => ({ forecastId: h.forecastId, revision: h.revision, probabilityBps: h.probabilityBps, createdAt: h.createdAt })),
      });
    }
    rooms.push({ roomId, marketId, forecasters });
  }
  return { marketId, rooms };
}

export async function getFinalizationRedis(r: RedisArenaOps, prefix: string, marketId: string): Promise<FinalizationRecord | null> {
  return parse<FinalizationRecord>(await r.hget(arenaKeys(prefix).final, marketId));
}

export async function commitFinalizationRedis(r: RedisArenaOps, prefix: string, input: CommitFinalizationInput): Promise<CommitFinalizationResult> {
  const k = arenaKeys(prefix);
  const f = input.finalization;
  const existing = await getFinalizationRedis(r, prefix, f.marketId);
  if (existing) return { status: "exists", finalization: existing };
  validateCommit(input);
  // Same integrity link as SQLite: each score must match the stored revision.
  for (const s of input.roomScores) {
    const hist = (await r.lrange(forecastKeys(prefix, s.roomId).hist(s.wallet), s.forecastRevision - 1, s.forecastRevision - 1)).map((x) => parse<ForecastRevisionRecord>(x))[0];
    if (!hist || hist.revision !== s.forecastRevision || hist.probabilityBps !== s.forecastProbabilityBps || hist.createdAt !== s.forecastSubmittedAt || hist.forecastId !== s.forecastId) {
      throw new FinalizationIntegrityError("score does not match the stored revision");
    }
  }
  // Every participant on the market (scored or not) leaves "pending" once it is scored.
  const participants = new Set<string>();
  if (f.status === "scored") {
    for (const roomId of await r.zrange(k.mrooms(f.marketId), 0, -1)) {
      for (const w of await r.zrange(forecastKeys(prefix, roomId).order, 0, -1)) participants.add(w);
    }
    for (const s of input.roomScores) participants.add(s.wallet);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const keys = [k.final, k.rep, k.ranked, k.provisional, k.score, k.global];
    const keyIndex = new Map<string, number>();
    const idx = (key: string) => {
      let i = keyIndex.get(key);
      if (!i) {
        keys.push(key);
        i = keys.length; // Lua KEYS are 1-based
        keyIndex.set(key, i);
      }
      return String(i);
    };
    const wallets = input.globalScores.map((g) => g.wallet);
    const prevRaw = wallets.length ? await r.hmget(k.rep, wallets) : [];
    const args: string[] = [f.marketId, JSON.stringify(f), String(input.roomScores.length), String(input.globalScores.length), String(wallets.length)];
    for (const s of input.roomScores) args.push(`${s.roomId}|${s.wallet}`, JSON.stringify(s), String(s.brierE8), `${pad15(s.firstForecastAt)}|${s.wallet}`, idx(k.rscore(s.roomId)));
    for (const g of input.globalScores) args.push(`${g.wallet}|${g.marketId}`, JSON.stringify(g), idx(k.wglobal(g.wallet)), String(g.finalizedAt), g.marketId, idx(k.pending(g.wallet)));
    wallets.forEach((w, i) => {
      const prev = parse<ReputationRecord>(prevRaw[i]);
      const next = reputationView(nextReputation(prev, w, input.globalScores));
      const stored: ReputationRecord = { wallet: next.wallet, scoredCount: next.scoredCount, sumBrierE8: next.sumBrierE8, firstScoredAt: next.firstScoredAt, lastScoredAt: next.lastScoredAt };
      args.push(w, prevRaw[i] ?? "", JSON.stringify(stored), prev ? reputationView(prev).rankKey : "", next.rankKey, next.ranked ? "R" : "P");
    });
    args.push(String(participants.size));
    for (const w of participants) args.push(idx(k.pending(w)));
    const reply = await r.eval(FINALIZE_SCRIPT, keys, args);
    const [tag, val] = Array.isArray(reply) ? reply.map((x) => String(x)) : [];
    if (tag === "OK") return { status: "committed", finalization: f };
    if (tag === "EXISTS") {
      const rec = parse<FinalizationRecord>(val);
      if (!rec) throw new RoomStoreUnavailableError("failure", "unreadable finalization record");
      return { status: "exists", finalization: rec };
    }
    if (tag === "DUP") throw new FinalizationIntegrityError(`score record already exists (${val})`);
    if (tag !== "STALE") throw new RoomStoreUnavailableError("failure", `finalization write rejected (${tag ?? "no reply"})`);
  }
  throw new RoomStoreUnavailableError("failure", "finalization kept racing other finalizations; retry");
}

export async function listForecastersRedis(r: RedisArenaOps, prefix: string, tier: "ranked" | "provisional", limit: number, offset: number): Promise<Page<ReputationRecord>> {
  const k = arenaKeys(prefix);
  const z = tier === "ranked" ? k.ranked : k.provisional;
  const [members, total] = await Promise.all([r.zrange(z, offset, offset + limit - 1), r.zcard(z)]);
  if (!members.length) return { items: [], total };
  const raws = await r.hmget(k.rep, members.map(walletFromRankKey));
  return { items: raws.map((x) => parse<ReputationRecord>(x)).filter((x): x is ReputationRecord => x !== null), total };
}

export async function getReputationRedis(r: RedisArenaOps, prefix: string, wallet: string) {
  return parse<ReputationRecord>(await r.hget(arenaKeys(prefix).rep, wallet));
}

export async function getRankRedis(r: RedisArenaOps, prefix: string, wallet: string): Promise<number | null> {
  const rep = await getReputationRedis(r, prefix, wallet);
  if (!rep) return null;
  const v = reputationView(rep);
  if (!v.ranked) return null;
  const rank = await r.zrank(arenaKeys(prefix).ranked, v.rankKey);
  return rank === null ? null : rank + 1;
}

export async function countPendingMarketsRedis(r: RedisArenaOps, prefix: string, wallets: string[]): Promise<Record<string, number>> {
  if (!wallets.length) return {};
  const k = arenaKeys(prefix);
  const reply = await r.eval(PENDING_SCRIPT, wallets.map(k.pending), []);
  const arr = Array.isArray(reply) ? reply : [];
  return Object.fromEntries(wallets.map((w, i) => [w, Math.max(0, Number(arr[i] ?? 0) || 0)]));
}

export async function listGlobalScoresRedis(r: RedisArenaOps, prefix: string, wallet: string, limit: number, offset: number): Promise<Page<GlobalScoreRecord>> {
  const k = arenaKeys(prefix);
  const total = await r.zcard(k.wglobal(wallet));
  if (!total) return { items: [], total };
  // Newest first: walk the ascending ZSET from the end (ties: marketId byte order, same as SQLite).
  const all = await r.zrange(k.wglobal(wallet), 0, -1);
  const scores = all.length ? await r.hmget(k.global, all.map((m) => `${wallet}|${m}`)) : [];
  const items = scores
    .map((x) => parse<GlobalScoreRecord>(x))
    .filter((x): x is GlobalScoreRecord => x !== null)
    .sort((a, b) => b.finalizedAt - a.finalizedAt || (a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0))
    .slice(offset, offset + limit);
  return { items, total };
}

export async function listRoomScoresRedis(r: RedisArenaOps, prefix: string, roomId: string, limit: number, offset: number): Promise<Page<ScoreRecord>> {
  const k = arenaKeys(prefix);
  const [members, total] = await Promise.all([r.zrange(k.rscore(roomId), offset, offset + limit - 1), r.zcard(k.rscore(roomId))]);
  if (!members.length) return { items: [], total };
  const raws = await r.hmget(k.score, members.map((m) => `${roomId}|${m.slice(m.indexOf("|") + 1)}`));
  return { items: raws.map((x) => parse<ScoreRecord>(x)).filter((x): x is ScoreRecord => x !== null), total };
}

export async function getRoomScoreRedis(r: RedisArenaOps, prefix: string, roomId: string, wallet: string): Promise<ScoreRecord | null> {
  return parse<ScoreRecord>(await r.hget(arenaKeys(prefix).score, `${roomId}|${wallet}`));
}

export async function getGlobalScoreRedis(r: RedisArenaOps, prefix: string, wallet: string, marketId: string): Promise<GlobalScoreRecord | null> {
  return parse<GlobalScoreRecord>(await r.hget(arenaKeys(prefix).global, `${wallet}|${marketId}`));
}

export async function listWalletRoomsRedis(r: RedisArenaOps, prefix: string, wallet: string, limit: number): Promise<WalletRoom[]> {
  const k = arenaKeys(prefix);
  const n = await r.zcard(k.wrooms(wallet));
  if (!n) return [];
  const ids = (await r.zrange(k.wrooms(wallet), Math.max(0, n - limit), -1)).reverse();
  const rooms = await r.mget(ids.map((id) => ROOM_KEY(prefix, id)));
  const out: WalletRoom[] = [];
  for (let i = 0; i < ids.length; i++) {
    const room = parse<{ marketId: string }>(rooms[i]);
    const cur = parse<ForecastRecord>(await r.hget(forecastKeys(prefix, ids[i]).cur, wallet));
    // Index entries are written before the forecast; only rooms with a stored forecast count.
    if (room && cur) out.push({ roomId: ids[i], marketId: room.marketId, firstForecastAt: cur.createdAt });
  }
  return out.sort((a, b) => b.firstForecastAt - a.firstForecastAt || (a.roomId < b.roomId ? -1 : 1));
}

export async function listUnfinalizedMarketsRedis(r: RedisArenaOps, prefix: string, limit: number): Promise<string[]> {
  const k = arenaKeys(prefix);
  const out: string[] = [];
  const PAGE = 100;
  for (let start = 0; out.length < limit; start += PAGE) {
    const ids = await r.zrange(k.markets, start, start + PAGE - 1);
    if (!ids.length) break;
    const finals = await r.hmget(k.final, ids);
    ids.forEach((id, i) => {
      if (!finals[i] && out.length < limit) out.push(id);
    });
    if (start > 10_000) break;
  }
  return out;
}
