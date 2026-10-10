/**
 * Phase 8: infrastructure verification helpers.
 *  - Redis adapter isolated-prefix option (live verification namespace) + key guard.
 *  - Server-side discovery / forecast-window RPC never falls back to the public RPC in production.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisRoomRepository, ROOMS_REDIS_PREFIX } from "@/lib/rooms/store/redis";
import { sessionIdHash } from "@/lib/rooms/auth";
import { readEventAccountFresh } from "@/lib/panta/chain-event-server";
import { FakeRedis } from "./helpers/fake-redis";
import { guardRedis, newIsolatedPrefix } from "./helpers/isolated-redis";

const W = "8h6tvqz6NgA3VrNELmkGhsZgHPr9uQaVfYL2DVKBoyMP";
const M = "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn";

describe("Redis isolated prefix (live-verification namespace)", () => {
  it("only pbc:phase8test:<random>: prefixes are accepted", () => {
    const f = new FakeRedis();
    for (const bad of ["", "pbc:rooms:v1:", "pbc:phase8test:", "pbc:phase8test:ABC:", "x:phase8test:abcdef12:", "pbc:phase8test:abcdef12"]) {
      expect(() => new RedisRoomRepository(f, { isolatedPrefix: bad })).toThrow();
    }
    expect(() => new RedisRoomRepository(f, { isolatedPrefix: newIsolatedPrefix() })).not.toThrow();
  });

  it("every key the adapter writes lives under the isolated prefix; production keys untouched", async () => {
    const f = new FakeRedis();
    await f.set(`${ROOMS_REDIS_PREFIX}public-sentinel`, "existing");
    const prefix = newIsolatedPrefix();
    const repo = new RedisRoomRepository(guardRedis(f, prefix), { isolatedPrefix: prefix });
    const now = Date.now();
    const room = { roomId: "room_p8_00000000000001", slug: "p8-live-check", title: "P8", description: "", creatorWallet: W, marketId: M, visibility: "public", status: "active", createdAt: now, updatedAt: now };
    await repo.createRoom(room as never, { key: "p8-idem-000000000001", fingerprint: "fp" });
    await repo.saveChallenge({ nonce: "n".repeat(32), wallet: W, message: "m", issuedAt: now, expiresAt: now + 60_000 } as never);
    await repo.consumeChallenge("n".repeat(32));
    await repo.createSession({ sidHash: sessionIdHash("s".repeat(43)), wallet: W, issuedAt: now, expiresAt: now + 60_000 });
    expect(await repo.getActiveSession(sessionIdHash("s".repeat(43)), now)).toMatchObject({ wallet: W });
    await repo.revokeSession(sessionIdHash("s".repeat(43)));
    expect(await repo.getRoomBySlug("p8-live-check")).toMatchObject({ roomId: room.roomId });
    const keys = [...f.kv.keys(), ...f.z.keys(), ...f.h.keys(), ...f.l.keys(), ...f.s.keys()];
    const ours = keys.filter((k) => k !== `${ROOMS_REDIS_PREFIX}public-sentinel`);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.every((k) => k.startsWith(prefix))).toBe(true);
    expect(await f.get(`${ROOMS_REDIS_PREFIX}public-sentinel`)).toBe("existing");
  });

  it("the guard refuses any key outside the namespace before the command reaches Redis", async () => {
    const f = new FakeRedis();
    const spy = vi.spyOn(f, "del");
    const g = guardRedis(f, newIsolatedPrefix());
    await expect(g.del(`${ROOMS_REDIS_PREFIX}room:x`)).rejects.toThrow(/outside the test namespace/);
    await expect(g.eval("return 1", ["pbc:other"], [])).rejects.toThrow(/outside/);
    await expect(g.multi([{ op: "set", key: "pbc:rooms:v1:x", value: "1" }])).rejects.toThrow(/outside/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("no public RPC fallback for server reads in production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("forecast-window chain read fails closed (no network call) when no private RPC is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SOLANA_RPC_URL", "");
    vi.stubEnv("PANTA_DISCOVERY_RPC_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await readEventAccountFresh(M);
    expect(r).toMatchObject({ status: "failed", error: "RPC not configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("shared store isolated prefix (live rate-limit verification only)", () => {
  it("accepts only pbc:phase8test:<random>: and defaults to the production prefix", async () => {
    const { upstashFromEnv } = await import("@/lib/shared-store");
    const env = { UPSTASH_REDIS_REST_URL: "https://example-test.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t".repeat(40), ROOMS_ALLOW_LOCAL_REDIS: "1" };
    for (const bad of ["pbc:", "pbc:rl:", "pbc:phase8test:", "pbc:phase8test:ABC:"]) expect(() => upstashFromEnv(env, { isolatedPrefix: bad })).toThrow();
    expect(upstashFromEnv(env, { isolatedPrefix: newIsolatedPrefix() })?.kind).toBe("redis");
    expect(upstashFromEnv(env)?.kind).toBe("redis");
    expect(upstashFromEnv({})).toBeNull();
  });
});

describe("test runs never reach a real Redis through the app's env lookups", () => {
  it("store credentials are blank inside vitest even if the shell exports them", async () => {
    const { sharedStore, __setSharedStoreForTests } = await import("@/lib/shared-store");
    const { resolveRoomStoreConfig } = await import("@/lib/rooms/store");
    for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) expect(process.env[k] ?? "").toBe("");
    __setSharedStoreForTests(undefined);
    expect(sharedStore()).toBeNull();
    expect(resolveRoomStoreConfig().kind).not.toBe("redis");
  });
});
