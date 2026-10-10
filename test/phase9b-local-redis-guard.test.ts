/**
 * Phase 9B: local runs never use Redis credentials that happen to be in the
 * environment (a dev box may export production Upstash vars) unless they opt in
 * with ROOMS_ALLOW_LOCAL_REDIS=1. On Vercel (VERCEL=1 + VERCEL_URL) nothing changes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_REDIS_OPT_IN, onVercel, sharedStoreCredentials, storeStatus, upstashFromEnv } from "@/lib/shared-store";
import { resolveRoomStoreConfig } from "@/lib/rooms/store";

// Unroutable placeholder (TEST-NET-ish private range), never a real instance.
const CREDS = { UPSTASH_REDIS_REST_URL: "https://10.255.255.1", UPSTASH_REDIS_REST_TOKEN: "placeholder-token-not-real" };
const KV = { KV_REST_API_URL: "https://10.255.255.1", KV_REST_API_TOKEN: "placeholder-token-not-real" };
const ON_VERCEL = { VERCEL: "1", VERCEL_URL: "briefcommand-git-release-rooms-v1-rishu4436s-projects.vercel.app" };

describe("local Redis guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("off Vercel, exported credentials are ignored: dev → SQLite, production build → fails closed, limiter → memory", () => {
    for (const c of [CREDS, KV]) {
      expect(sharedStoreCredentials(c)).toBeNull();
      expect(upstashFromEnv(c)).toBeNull();
      expect(resolveRoomStoreConfig({ ...c, NODE_ENV: "development" }).kind).toBe("sqlite");
      expect(resolveRoomStoreConfig({ ...c, NODE_ENV: "production" }).kind).toBe("unavailable");
      expect(storeStatus(c)).toMatchObject({ mode: "memory", configured: false, env: { url: null, token: null } });
    }
  });

  it("a `vercel env pull` file (VERCEL=1, empty VERCEL_URL) is not treated as Vercel", () => {
    expect(onVercel({ VERCEL: "1", VERCEL_URL: "" })).toBe(false);
    expect(onVercel({ VERCEL: "1" })).toBe(false);
    expect(sharedStoreCredentials({ ...CREDS, VERCEL: "1", VERCEL_URL: "" })).toBeNull();
  });

  it("explicit opt-in or a real Vercel deployment uses the credentials", () => {
    expect(sharedStoreCredentials({ ...CREDS, [LOCAL_REDIS_OPT_IN]: "1" })).not.toBeNull();
    expect(sharedStoreCredentials({ ...CREDS, [LOCAL_REDIS_OPT_IN]: "true" })).toBeNull(); // only "1"
    expect(sharedStoreCredentials({ ...CREDS, ...ON_VERCEL })).not.toBeNull();
    expect(resolveRoomStoreConfig({ ...CREDS, ...ON_VERCEL, NODE_ENV: "production" }).kind).toBe("redis");
    expect(onVercel(ON_VERCEL)).toBe(true);
  });

  it("with credentials in process.env and no opt-in, a rate-limited request makes no network call", async () => {
    vi.resetModules();
    for (const [k, v] of Object.entries(CREDS)) vi.stubEnv(k, v);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv(LOCAL_REDIS_OPT_IN, "");
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("@/lib/shared-store");
    mod.__setSharedStoreForTests(undefined);
    expect(mod.sharedStore()).toBeNull();
    const r = await mod.limitShared("p9b:local", 5, 60_000);
    expect(r.store).toBe("memory");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
