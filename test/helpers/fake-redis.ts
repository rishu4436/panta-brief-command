/**
 * In-memory RedisLike for adapter tests: real NX / GETDEL / PX semantics for
 * strings, sorted sets, hashes and lists, and EVAL that runs the adapter's
 * actual Lua source in the fengari Lua VM (Lua 5.3) against this keyspace,
 * with Redis' reply conventions (nil → false, integers → numbers). Scripts run
 * to completion before any other command, like Redis.
 *
 * Not a live Upstash test: it checks the script's logic and the adapter's
 * use of it, not Upstash's REST transport.
 */
import { lauxlib, lua, lualib, to_luastring } from "fengari";
import type { RedisLike, RedisWrite } from "@/lib/rooms/store/redis";

type Reply = string | number | boolean | null | Reply[];

export class FakeRedis implements RedisLike {
  kv = new Map<string, { v: string; exp: number | null }>();
  z = new Map<string, Map<string, number>>();
  h = new Map<string, Map<string, string>>();
  l = new Map<string, string[]>();
  failMulti = false;
  failEval = false;
  evalCalls = 0;

  private live(k: string) {
    const e = this.kv.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= Date.now()) {
      this.kv.delete(k);
      return null;
    }
    return e.v;
  }
  async get(k: string) {
    return this.live(k);
  }
  async mget(keys: string[]) {
    return keys.map((k) => this.live(k));
  }
  async setNx(k: string, v: string, px?: number) {
    if (this.live(k) !== null) return false;
    this.kv.set(k, { v, exp: px ? Date.now() + px : null });
    return true;
  }
  async setPx(k: string, v: string, px: number) {
    this.kv.set(k, { v, exp: Date.now() + px });
  }
  async set(k: string, v: string) {
    this.kv.set(k, { v, exp: null });
  }
  async del(k: string) {
    this.kv.delete(k);
  }
  async getdel(k: string) {
    const v = this.live(k);
    this.kv.delete(k);
    return v;
  }
  async zrevrange(k: string, start: number, stop: number) {
    const m = this.z.get(k);
    if (!m) return [];
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
      .map(([member]) => member)
      .slice(start, stop + 1);
  }
  async zcard(k: string) {
    return this.z.get(k)?.size ?? 0;
  }
  async hget(k: string, f: string) {
    return this.h.get(k)?.get(f) ?? null;
  }
  async hmget(k: string, fields: string[]) {
    return fields.map((f) => this.h.get(k)?.get(f) ?? null);
  }
  async hgetall(k: string) {
    return Object.fromEntries(this.h.get(k) ?? []);
  }
  async lrange(k: string, start: number, stop: number) {
    const list = this.l.get(k) ?? [];
    const n = list.length;
    const s = start < 0 ? Math.max(0, n + start) : start;
    const e = stop < 0 ? n + stop : Math.min(stop, n - 1);
    return e < s ? [] : list.slice(s, e + 1);
  }
  async multi(writes: RedisWrite[]) {
    if (this.failMulti) throw new Error("boom");
    for (const w of writes) {
      if (w.op === "set") this.kv.set(w.key, { v: w.value, exp: null });
      else {
        const m = this.z.get(w.key) ?? new Map();
        m.set(w.member, w.score);
        this.z.set(w.key, m);
      }
    }
  }

  /** Synchronous command dispatcher used by redis.call inside scripts. */
  command(args: string[]): Reply {
    const [name, ...a] = args;
    switch (name.toUpperCase()) {
      case "GET":
        return this.live(a[0]);
      case "SET": {
        const px = a.findIndex((x) => x.toUpperCase() === "PX");
        this.kv.set(a[0], { v: a[1], exp: px >= 0 ? Date.now() + Number(a[px + 1]) : null });
        return "OK";
      }
      case "HGET":
        return this.h.get(a[0])?.get(a[1]) ?? null;
      case "HSET": {
        const m = this.h.get(a[0]) ?? new Map<string, string>();
        const added = m.has(a[1]) ? 0 : 1;
        m.set(a[1], a[2]);
        this.h.set(a[0], m);
        return added;
      }
      case "HINCRBY": {
        if (!/^-?\d+$/.test(a[2])) throw new Error(`ERR value is not an integer: ${a[2]}`);
        const m = this.h.get(a[0]) ?? new Map<string, string>();
        const v = Number(m.get(a[1]) ?? 0) + Number(a[2]);
        m.set(a[1], String(v));
        this.h.set(a[0], m);
        return v;
      }
      case "ZADD": {
        if (!/^-?\d+(\.\d+)?$/.test(a[1])) throw new Error(`ERR score is not a float: ${a[1]}`);
        const m = this.z.get(a[0]) ?? new Map<string, number>();
        const added = m.has(a[2]) ? 0 : 1;
        m.set(a[2], Number(a[1]));
        this.z.set(a[0], m);
        return added;
      }
      case "RPUSH": {
        const list = this.l.get(a[0]) ?? [];
        list.push(...a.slice(1));
        this.l.set(a[0], list);
        return list.length;
      }
      case "LLEN":
        return this.l.get(a[0])?.length ?? 0;
      default:
        throw new Error(`FakeRedis: command not supported in scripts: ${name}`);
    }
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    this.evalCalls += 1;
    if (this.failEval) throw new Error("eval boom");
    return runLua(this, script, keys, args);
  }
}

function pushReply(L: unknown, r: Reply) {
  if (r === null || r === false) lua.lua_pushboolean(L, false);
  else if (r === true) lua.lua_pushboolean(L, true);
  else if (typeof r === "number") lua.lua_pushinteger(L, r);
  else if (typeof r === "string") lua.lua_pushstring(L, to_luastring(r));
  else {
    lua.lua_createtable(L, r.length, 0);
    r.forEach((x, i) => {
      pushReply(L, x);
      lua.lua_rawseti(L, -2, i + 1);
    });
  }
}

function readReply(L: unknown, idx: number): Reply {
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TNIL) return null;
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx) ? 1 : null;
  if (t === lua.LUA_TNUMBER) return Math.trunc(lua.lua_tonumber(L, idx));
  if (t === lua.LUA_TSTRING) return lua.lua_tojsstring(L, idx);
  if (t === lua.LUA_TTABLE) {
    const out: Reply[] = [];
    const n = lua.lua_rawlen(L, idx);
    for (let i = 1; i <= n; i++) {
      lua.lua_rawgeti(L, idx, i);
      out.push(readReply(L, -1));
      lua.lua_pop(L, 1);
    }
    return out;
  }
  throw new Error("unsupported Lua reply type");
}

function setArray(L: unknown, name: string, values: string[]) {
  lua.lua_createtable(L, values.length, 0);
  values.forEach((v, i) => {
    lua.lua_pushstring(L, to_luastring(v));
    lua.lua_rawseti(L, -2, i + 1);
  });
  lua.lua_setglobal(L, to_luastring(name));
}

function runLua(fake: FakeRedis, script: string, keys: string[], args: string[]): Reply {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  setArray(L, "KEYS", keys);
  setArray(L, "ARGV", args);
  let callError: string | null = null;
  lua.lua_createtable(L, 0, 1);
  lua.lua_pushcfunction(L, (S) => {
    const n = lua.lua_gettop(S);
    const argv: string[] = [];
    for (let i = 1; i <= n; i++) {
      const t = lua.lua_type(S, i);
      // Redis converts Lua numbers to strings; whole numbers print without ".0".
      argv.push(t === lua.LUA_TNUMBER ? String(lua.lua_tonumber(S, i)) : lua.lua_tojsstring(S, i));
    }
    try {
      pushReply(S, fake.command(argv));
      return 1;
    } catch (e) {
      callError = e instanceof Error ? e.message : String(e);
      return lauxlib.luaL_error(S, to_luastring(callError));
    }
  });
  lua.lua_setfield(L, -2, to_luastring("call"));
  lua.lua_setglobal(L, to_luastring("redis"));
  if (lauxlib.luaL_loadstring(L, to_luastring(script)) !== lua.LUA_OK) throw new Error(`Lua compile error: ${lua.lua_tojsstring(L, -1)}`);
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw new Error(`Lua runtime error: ${callError ?? lua.lua_tojsstring(L, -1)}`);
  return readReply(L, -1);
}
