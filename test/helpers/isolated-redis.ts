/**
 * Redis backends with an isolated key namespace, for the repository contract
 * suites (rooms, forecasts, arena, debate, studio, sessions).
 *
 *  - "redis (fake, isolated prefix)": always on. FakeRedis behind the key guard;
 *    proves every key the real adapter touches lives under the given prefix.
 *  - "redis (LIVE Upstash, isolated prefix)": only when PHASE8_LIVE_UPSTASH=1 and
 *    PHASE8_UPSTASH_ENV_FILE points at a chmod-600 file with
 *    UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. The credentials are read
 *    from that file only (never put into process.env, so the app's shared store
 *    / rate limits never reach the live instance) and never printed.
 *
 * Live safety: every key must start with `pbc:phase8test:<random>:` (guard
 * throws otherwise, before the command is sent); every key written gets a 1 h
 * TTL if it has none; afterAll deletes the recorded keys and then SCANs only
 * `pbc:phase8test:<random>:*` for stragglers. Never FLUSH, never other keys.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { afterAll } from "vitest";
import { ISOLATED_PREFIX_RE, RedisRoomRepository, upstashRedisLike, type RedisLike, type RedisWrite } from "@/lib/rooms/store/redis";
import type { RoomRepository } from "@/lib/rooms/store/types";
import { FakeRedis } from "./fake-redis";

export const LIVE_TTL_MS = 3600_000;
export const newIsolatedPrefix = () => `pbc:phase8test:${randomBytes(8).toString("hex")}:`;

/** Wrap a RedisLike so a key outside `prefix` throws before anything is sent; report written keys. */
export function guardRedis(inner: RedisLike, prefix: string, onWrite?: (keys: string[]) => Promise<void>): RedisLike {
  if (!ISOLATED_PREFIX_RE.test(prefix)) throw new Error("not an isolated prefix");
  const ok = (k: string) => {
    if (typeof k !== "string" || !k.startsWith(prefix)) throw new Error("isolated-redis guard: key outside the test namespace");
    return k;
  };
  const wrote = async (keys: string[]) => {
    if (onWrite) await onWrite(keys);
  };
  return {
    get: async (k) => inner.get(ok(k)),
    mget: async (keys) => inner.mget(keys.map(ok)),
    setNx: async (k, v, px) => {
      const r = await inner.setNx(ok(k), v, px);
      await wrote([k]);
      return r;
    },
    setPx: async (k, v, px) => {
      await inner.setPx(ok(k), v, px);
    },
    set: async (k, v) => {
      await inner.set(ok(k), v);
      await wrote([k]);
    },
    del: async (k) => inner.del(ok(k)),
    getdel: async (k) => inner.getdel(ok(k)),
    zrevrange: async (k, a, b) => inner.zrevrange(ok(k), a, b),
    zrange: async (k, a, b) => inner.zrange(ok(k), a, b),
    zrank: async (k, m) => inner.zrank(ok(k), m),
    zcard: async (k) => inner.zcard(ok(k)),
    hget: async (k, f) => inner.hget(ok(k), f),
    hmget: async (k, f) => inner.hmget(ok(k), f),
    hgetall: async (k) => inner.hgetall(ok(k)),
    lrange: async (k, a, b) => inner.lrange(ok(k), a, b),
    eval: async (script, keys, args) => {
      keys.forEach(ok);
      const r = await inner.eval(script, keys, args);
      await wrote(keys);
      return r;
    },
    multi: async (writes: RedisWrite[]) => {
      writes.forEach((w) => ok(w.key));
      await inner.multi(writes);
      await wrote(writes.map((w) => w.key));
    },
  };
}

export type IsolatedBackend = { name: string; live: boolean; open: () => { repo: RoomRepository; reopen: () => RoomRepository; prefix: string } };

function fakeIsolated(): IsolatedBackend {
  return {
    name: "redis (fake, isolated prefix)",
    live: false,
    open: () => {
      const prefix = newIsolatedPrefix();
      const fake = new FakeRedis();
      const r = guardRedis(fake, prefix);
      return { repo: new RedisRoomRepository(r, { isolatedPrefix: prefix }), reopen: () => new RedisRoomRepository(r, { isolatedPrefix: prefix }), prefix };
    },
  };
}

function readLiveCreds(): { url: string; token: string } | null {
  if (process.env.PHASE8_LIVE_UPSTASH !== "1") return null;
  // The app's own env lookups (shared store, room store) must never see the live
  // instance: they would use production key prefixes. Run with those vars unset.
  if (["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"].some((k) => (process.env[k] || "").trim())) {
    throw new Error("live mode refuses to run with UPSTASH_*/KV_REST_API_* in the process env; pass them via PHASE8_UPSTASH_ENV_FILE only");
  }
  const file = process.env.PHASE8_UPSTASH_ENV_FILE;
  if (!file) throw new Error("PHASE8_LIVE_UPSTASH=1 needs PHASE8_UPSTASH_ENV_FILE");
  if ((statSync(file).mode & 0o077) !== 0) throw new Error("PHASE8_UPSTASH_ENV_FILE must be chmod 600");
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
    if (m) vars[m[1]] = m[2].trim();
  }
  const url = vars.UPSTASH_REDIS_REST_URL || vars.KV_REST_API_URL;
  const token = vars.UPSTASH_REDIS_REST_TOKEN || vars.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("credentials file lacks UPSTASH_REDIS_REST_URL / _TOKEN");
  return { url, token };
}

const TTL_IF_NONE = "if redis.call('PTTL', KEYS[1]) == -1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return 1";

let liveCleanupRegistered = false;
function liveIsolated(): IsolatedBackend | null {
  const creds = readLiveCreds();
  if (!creds) return null;
  const raw = new Redis({ url: creds.url, token: creds.token, automaticDeserialization: false });
  const inner = upstashRedisLike(creds.url, creds.token);
  const prefixes = new Set<string>();
  const written = new Set<string>();
  if (!liveCleanupRegistered) {
    liveCleanupRegistered = true;
    afterAll(async () => {
      let underPrefix = 0;
      for (const p of prefixes) {
        let cursor = "0";
        do {
          const [next, keys] = (await raw.scan(cursor, { match: `${p}*`, count: 500 })) as [string | number, string[]];
          underPrefix += keys.length;
          cursor = String(next);
        } while (cursor !== "0");
      }
      console.log(`[isolated-redis] live: ${prefixes.size} prefixes, ${written.size} keys written, ${underPrefix} keys under test prefixes before cleanup`);
      for (const k of written) await raw.del(k);
      for (const p of prefixes) {
        if (!ISOLATED_PREFIX_RE.test(p)) continue;
        let cursor = "0";
        do {
          const [next, keys] = (await raw.scan(cursor, { match: `${p}*`, count: 200 })) as [string | number, string[]];
          for (const k of keys) if (k.startsWith(p)) await raw.del(k);
          cursor = String(next);
        } while (cursor !== "0");
      }
      let left = 0;
      for (const p of prefixes) {
        let cursor = "0";
        do {
          const [next, keys] = (await raw.scan(cursor, { match: `${p}*`, count: 500 })) as [string | number, string[]];
          left += keys.length;
          cursor = String(next);
        } while (cursor !== "0");
      }
      console.log(`[isolated-redis] live: ${left} keys under test prefixes after cleanup`);
    }, 300_000);
  }
  return {
    name: "redis (LIVE Upstash, isolated prefix)",
    live: true,
    open: () => {
      const prefix = newIsolatedPrefix();
      prefixes.add(prefix);
      const r = guardRedis(inner, prefix, async (keys) => {
        for (const k of keys) {
          written.add(k);
          await raw.eval(TTL_IF_NONE, [k], [String(LIVE_TTL_MS)]);
        }
      });
      return { repo: new RedisRoomRepository(r, { isolatedPrefix: prefix }), reopen: () => new RedisRoomRepository(r, { isolatedPrefix: prefix }), prefix };
    },
  };
}

/** Isolated backends to add to each contract suite (live only when explicitly enabled). */
export function isolatedRedisBackends(): IsolatedBackend[] {
  const live = liveIsolated();
  return live ? [fakeIsolated(), live] : [fakeIsolated()];
}
