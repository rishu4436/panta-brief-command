/**
 * Phase 7C: production security hardening.
 *  1. Server-side session revocation (active-session allowlist, v2 cookies).
 *  2. Positions: malformed / incomplete responses fail closed.
 *  3. Embed eligibility = the room panel's / Studio's shared window decision.
 */
import { createHmac, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import bs58 from "bs58";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildEmbedModel, embedEligibility } from "@/lib/embed/model";
import { renderEmbed } from "@/lib/embed/html";
import { DEFAULT_EMBED_OPTIONS } from "@/lib/embed/options";
import { __setForecastDepsForTests } from "@/lib/forecasts/deps";
import { emptyAggregate } from "@/lib/forecasts/domain";
import { evaluateForecastWindow, type ForecastWindow } from "@/lib/forecasts/window";
import { forecastEligibility, publicWindow } from "@/lib/forecasts/window-public";
import { qk } from "@/lib/data/hooks";
import { onTradeConfirmed } from "@/lib/data/reconcile";
import { evaluateReconcile, positionBaseline, tradeSession } from "@/lib/data/trade-session";
import { exposureView, portfolioReadState, POSITIONS_READ_FAILED_NOTE, exposureNote } from "@/lib/panta/exposure-view";
import type { Market } from "@/lib/panta/domain";
import { fetchPositions, parsePositions, parsePositionsResult, PositionsUnverifiedError } from "@/lib/panta/positions";
import { portfolioIntel } from "@/lib/panta/position-intel";
import {
  checkSession,
  issueSession,
  readSession,
  revokeSessionCookie,
  sessionIdHash,
  sessionSecret,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSession,
} from "@/lib/rooms/auth";
import { __setRoomRepositoryForTests, createRoomRepository, resolveRoomStoreConfig, type RoomRepository } from "@/lib/rooms/store";
import { RedisRoomRepository } from "@/lib/rooms/store/redis";
import { SqliteRoomRepository } from "@/lib/rooms/store/sqlite";
import { forecastingState } from "@/lib/studio/service";
import { roomKeys, signOutAndRefresh } from "@/lib/rooms/client";
import { parseSyncMessage, SESSION_SYNC_CHANNEL } from "@/lib/rooms/session-sync";
import { FakeRedis } from "./helpers/fake-redis";
import { isolatedRedisBackends } from "./helpers/isolated-redis";

const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), "p7c-")), "rooms.sqlite");
const secret = () => sessionSecret()!;

function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url"));
  return { address, signText: (m: string) => bs58.encode(edSign(null, Buffer.from(m, "utf8"), privateKey)) };
}

type Made = { name: string; repo: RoomRepository; file: string | null; fake: FakeRedis | null };
const BACKENDS: { name: string; make: () => Made }[] = [
  { name: "sqlite", make: () => { const file = tmp(); return { name: "sqlite", repo: new SqliteRoomRepository(file), file, fake: null }; } },
  { name: "redis", make: () => { const fake = new FakeRedis(); return { name: "redis", repo: new RedisRoomRepository(fake), file: null, fake }; } },
  ...isolatedRedisBackends().map((b) => ({ name: b.name, make: (): Made => ({ name: b.name, repo: b.open().repo, file: null, fake: null }) })),
];

// ---------------------------------------------------------------- HTTP helpers

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
let routes: { challenge: Handler; verify: Handler; sessionGET: Handler; sessionDELETE: Handler; overview: Handler };
let ipSeq = 0;
function req(url: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "x-vercel-forwarded-for": `203.0.113.${(++ipSeq % 250) + 1}`, "user-agent": "Mozilla/5.0 p7c" };
  if (init.origin !== null) headers.origin = init.origin ?? "http://localhost";
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
async function signIn(w = wallet()) {
  const c = await routes.challenge(req("/api/rooms/auth/challenge", { method: "POST", body: { wallet: w.address } }));
  const { nonce, message } = (await c.json()) as { nonce: string; message: string };
  const v = await routes.verify(req("/api/rooms/auth/verify", { method: "POST", body: { nonce, signature: w.signText(message) } }));
  return { status: v.status, setCookie: v.headers.get("set-cookie") ?? "", cookie: (v.headers.get("set-cookie") ?? "").split(";")[0], body: await v.json(), address: w.address };
}
const sessionWallet = async (cookie?: string) => ((await (await routes.sessionGET(req("/api/rooms/auth/session", { cookie, origin: null }))).json()) as { wallet: string | null }).wallet;
const logout = (cookie?: string) => routes.sessionDELETE(req("/api/rooms/auth/session", { method: "DELETE", cookie }));
const overviewStatus = async (cookie?: string) => (await routes.overview(req("/api/studio/overview", { cookie, origin: null }))).status;

beforeAll(async () => {
  routes = {
    challenge: (await import("@/app/api/rooms/auth/challenge/route")).POST as Handler,
    verify: (await import("@/app/api/rooms/auth/verify/route")).POST as Handler,
    sessionGET: (await import("@/app/api/rooms/auth/session/route")).GET as Handler,
    sessionDELETE: (await import("@/app/api/rooms/auth/session/route")).DELETE as Handler,
    overview: (await import("@/app/api/studio/overview/route")).GET as Handler,
  };
});
afterAll(() => __setRoomRepositoryForTests(undefined));

// ---------------------------------------------------------------- 1. sessions

describe.each(BACKENDS)("session revocation ($name)", ({ make }) => {
  let m: Made;
  const use = () => {
    m = make();
    __setRoomRepositoryForTests(m.repo);
  };
  afterEach(() => __setRoomRepositoryForTests(undefined));

  it("copied cookie is rejected immediately after logout; fresh sign-in works", async () => {
    use();
    const s = await signIn();
    expect(s.status).toBe(200);
    expect(s.setCookie).toMatch(/HttpOnly/i);
    expect(s.setCookie).toMatch(/SameSite=strict/i);
    expect(s.setCookie).toMatch(/Max-Age=1800/);
    const copied = s.cookie; // e.g. exported from DevTools by an attacker
    expect(await sessionWallet(copied)).toBe(s.address);
    expect(await overviewStatus(copied)).toBe(200);
    const out = await logout(s.cookie);
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await sessionWallet(copied)).toBeNull();
    expect(await overviewStatus(copied)).toBe(401);
    const again = await signIn();
    expect(again.status).toBe(200);
    expect(again.cookie).not.toBe(copied);
    expect(await overviewStatus(again.cookie)).toBe(200);
    expect(await overviewStatus(copied)).toBe(401);
  });

  it("session id never leaves the HttpOnly cookie: not in JSON responses, not stored raw", async () => {
    use();
    const s = await signIn();
    const sess = readSession(s.cookie.slice(SESSION_COOKIE.length + 1), Date.now(), secret())!;
    expect(sess.sid).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits
    expect(JSON.stringify(s.body)).not.toContain(sess.sid);
    const getBody = await (await routes.sessionGET(req("/api/rooms/auth/session", { cookie: s.cookie, origin: null }))).text();
    expect(getBody).not.toContain(sess.sid);
    expect(Object.keys(JSON.parse(getBody)).sort()).toEqual(["expiresAt", "wallet"]);
    expect(await m.repo.getActiveSession(sessionIdHash(sess.sid), Date.now())).toMatchObject({ wallet: s.address });
    if (m.file) expect(readFileSync(m.file).includes(Buffer.from(sess.sid))).toBe(false);
    if (m.fake) {
      const dump = JSON.stringify([...m.fake.kv.entries()]);
      expect(dump).toContain(`:session:${sessionIdHash(sess.sid)}`);
      expect([...m.fake.kv.values()].every((e) => typeof e.exp === "number")).toBe(true); // TTL-keyed
      expect(dump).not.toContain(sess.sid);
    }
  });

  it("concurrent logouts are safe and idempotent", async () => {
    use();
    const s = await signIn();
    const results = await Promise.all([logout(s.cookie), logout(s.cookie), logout(s.cookie)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await logout(s.cookie)).status).toBe(200);
    expect((await logout()).status).toBe(200); // no cookie at all
    expect(await sessionWallet(s.cookie)).toBeNull();
  });

  it("expired sessions are rejected and can't be revived", async () => {
    use();
    const w = wallet().address;
    const t0 = Date.now();
    const { value, session } = await issueSession(m.repo, w, t0, secret());
    expect((await checkSession(m.repo, value, t0 + 1_000, secret())).session?.wallet).toBe(w);
    expect((await checkSession(m.repo, value, t0 + SESSION_TTL_MS, secret())).session).toBeNull();
    expect(await m.repo.getActiveSession(sessionIdHash(session.sid), t0 + SESSION_TTL_MS + 1)).toBeNull();
    // A record that has expired doesn't come back for a cookie claiming a longer life (forged exp needs the MAC anyway).
    const longer = signSession(w, t0 + 60_000, secret());
    expect((await checkSession(m.repo, longer.value, t0 + 61_000, secret())).session).toBeNull(); // never registered
    // A new record can't be created for a session that is already over.
    await expect(m.repo.createSession({ sidHash: "x".repeat(64), wallet: w, issuedAt: t0, expiresAt: t0 })).rejects.toThrow();
  });

  it("legacy v1 cookies (no tracked session id) and unregistered v2 cookies are invalid", async () => {
    use();
    const w = wallet().address;
    const now = Date.now();
    const payload = Buffer.from(JSON.stringify({ v: 1, w, iat: now, exp: now + SESSION_TTL_MS, sid: "abcdef0123456789ab" })).toString("base64url");
    const mac = createHmac("sha256", secret()).update(`pbc-rooms-session.v1.${payload}`).digest().toString("base64url");
    const legacy = `v1.${payload}.${mac}`; // exactly what Phase ≤ 7B issued
    expect(readSession(legacy, now, secret())).toBeNull();
    expect(await sessionWallet(`${SESSION_COOKIE}=${legacy}`)).toBeNull();
    expect(await overviewStatus(`${SESSION_COOKIE}=${legacy}`)).toBe(401);
    const unregistered = signSession(w, now, secret()).value;
    expect(readSession(unregistered, now, secret())?.wallet).toBe(w); // MAC is fine...
    expect(await overviewStatus(`${SESSION_COOKIE}=${unregistered}`)).toBe(401); // ...but no active record
  });

  it("a record for another wallet doesn't authenticate the cookie's wallet", async () => {
    use();
    const a = wallet().address;
    const b = wallet().address;
    const now = Date.now();
    const s = signSession(a, now, secret());
    await m.repo.createSession({ sidHash: sessionIdHash(s.session.sid), wallet: b, issuedAt: now, expiresAt: s.session.expiresAt });
    expect((await checkSession(m.repo, s.value, now + 1, secret())).session).toBeNull();
  });
});

describe("session storage unavailable → authenticated ops fail closed", () => {
  afterEach(() => __setRoomRepositoryForTests(undefined));

  it("session check error → 503 on protected routes, null on the session read; never authenticated", async () => {
    const real = new SqliteRoomRepository(tmp());
    __setRoomRepositoryForTests(real);
    const s = await signIn();
    const broken = new Proxy(real, {
      get(t, p, r) {
        if (p === "getActiveSession" || p === "revokeSession") return async () => { throw new Error("store down"); };
        return Reflect.get(t, p, r);
      },
    }) as RoomRepository;
    __setRoomRepositoryForTests(broken);
    const check = await checkSession(broken, s.cookie.slice(SESSION_COOKIE.length + 1), Date.now(), secret());
    expect(check).toEqual({ session: null, unavailable: true });
    expect(await overviewStatus(s.cookie)).toBe(503);
    expect((await routes.sessionGET(req("/api/rooms/auth/session", { cookie: s.cookie, origin: null }))).status).toBe(503);
    // Logout can't revoke → 503, and the cookie is NOT cleared (the user can retry; nothing pretends it worked).
    const out = await logout(s.cookie);
    expect(out.status).toBe(503);
    expect(out.headers.get("set-cookie")).toBeNull();
    // Store back: the session is still live (it was never revoked) and logout now works.
    __setRoomRepositoryForTests(real);
    expect(await overviewStatus(s.cookie)).toBe(200);
    expect((await logout(s.cookie)).status).toBe(200);
    expect(await overviewStatus(s.cookie)).toBe(401);
  });

  it("can't record the session → sign-in fails (503) and no cookie is set", async () => {
    const real = new SqliteRoomRepository(tmp());
    __setRoomRepositoryForTests(
      new Proxy(real, {
        get(t, p, r) {
          if (p === "createSession") return async () => { throw new Error("store down"); };
          return Reflect.get(t, p, r);
        },
      }) as RoomRepository,
    );
    const s = await signIn();
    expect(s.status).toBe(503);
    expect(s.setCookie).toBe("");
  });

  it("production never uses an in-memory session registry", async () => {
    expect(resolveRoomStoreConfig({ NODE_ENV: "production" }).kind).toBe("unavailable");
    expect(resolveRoomStoreConfig({ NODE_ENV: "production", VERCEL: "1" }).kind).toBe("unavailable");
    const repo = createRoomRepository({ kind: "unavailable", reason: "test" });
    await expect(repo.createSession({ sidHash: "a".repeat(64), wallet: "w", issuedAt: 1, expiresAt: 2 })).rejects.toThrow();
    await expect(repo.getActiveSession("a".repeat(64), 1)).rejects.toThrow();
    expect(sessionSecret({ NODE_ENV: "production" })).toBeNull();
  });

  it("revokeSessionCookie ignores unsigned / legacy cookies (nothing to revoke) and revokes expired-but-signed ones", async () => {
    const repo = new SqliteRoomRepository(tmp());
    expect(await revokeSessionCookie(repo, "v1.x.y", Date.now(), secret())).toBe(false);
    expect(await revokeSessionCookie(repo, undefined, Date.now(), secret())).toBe(false);
    const t0 = Date.now() - SESSION_TTL_MS - 5_000;
    const old = signSession(wallet().address, t0, secret());
    expect(await revokeSessionCookie(repo, old.value, Date.now(), secret())).toBe(true);
  });
});

describe("cross-tab logout regression (7B sync) against the real logout route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __setRoomRepositoryForTests(undefined);
  });
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const wire = (cookie: string) =>
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const r = await routes.sessionDELETE(req(url, { method: init.method, cookie }));
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
    });
  async function run() {
    vi.stubGlobal("window", { localStorage: null, addEventListener: () => undefined, removeEventListener: () => undefined });
    const otherTab = new BroadcastChannel(SESSION_SYNC_CHANNEL);
    const heard: unknown[] = [];
    otherTab.onmessage = (e) => heard.push(e.data);
    const invalidated: unknown[] = [];
    const res = await signOutAndRefresh({ invalidateQueries: async (f) => void invalidated.push(f.queryKey) });
    await tick();
    otherTab.close();
    return { res, heard, invalidated };
  }

  it("revoked → other tabs told 'signed-out' once, and the old cookie is dead for them too", async () => {
    const repo = new SqliteRoomRepository(tmp());
    __setRoomRepositoryForTests(repo);
    const s = await signIn();
    wire(s.cookie);
    const { res, heard, invalidated } = await run();
    expect(res).toEqual({ ok: true });
    expect(heard).toHaveLength(1);
    expect(parseSyncMessage(heard[0])?.type).toBe("signed-out");
    expect(invalidated).toEqual([roomKeys.session()]);
    vi.unstubAllGlobals();
    expect(await sessionWallet(s.cookie)).toBeNull();
  });

  it("revoke failed (store down, 503) → nothing announced; this tab re-reads the truth", async () => {
    const real = new SqliteRoomRepository(tmp());
    __setRoomRepositoryForTests(real);
    const s = await signIn();
    __setRoomRepositoryForTests(
      new Proxy(real, {
        get(t, p, r) {
          if (p === "revokeSession") return async () => { throw new Error("store down"); };
          return Reflect.get(t, p, r);
        },
      }) as RoomRepository,
    );
    wire(s.cookie);
    const { res, heard, invalidated } = await run();
    expect(res).toEqual({ ok: false });
    expect(heard).toEqual([]);
    expect(invalidated).toEqual([roomKeys.session()]);
  });
});

// ---------------------------------------------------------------- 2. positions

const W = "8h6tvqz6NgA3VrNELmkGhsZgHPr9uQaVfYL2DVKBoyMP";
const M = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";
const row = (o: Record<string, unknown> = {}) => ({ marketId: M, side: "no", shares: "10.184331", phase: "primary", claimable: false, ...o });

describe("positions parser fails closed", () => {
  it("valid empty → confirmed empty", () => {
    expect(parsePositionsResult({ wallet: W, positions: [] }, W)).toEqual({ kind: "ok", positions: [] });
    expect(parsePositions({ wallet: W, positions: [] }, W)).toEqual([]);
  });

  it("valid non-empty (live fixture) → all rows", () => {
    const fx = JSON.parse(readFileSync("test/fixtures/positions.live-2026-10-03.json", "utf8"));
    const r = parsePositionsResult(fx, fx.wallet);
    expect(r.kind).toBe("ok");
    expect(r.kind === "ok" && r.positions.length).toBe(fx.positions.length);
  });

  it.each([
    ["null", null],
    ["empty object", {}],
    ["string body", "<html>502</html>"],
    ["positions not an array", { wallet: W, positions: "none" }],
    ["positions null", { wallet: W, positions: null }],
    ["top-level array", [row()]],
    ["different wallet", { wallet: "2hRywEUiyMvZd2gp9UD6nm5wqzrcwRo3qE7xyiCnDkKZ", positions: [] }],
  ])("malformed (%s) → PositionsUnverifiedError, never []", (_n, raw) => {
    expect(parsePositionsResult(raw, W).kind).toBe("malformed");
    expect(() => parsePositions(raw, W)).toThrow(PositionsUnverifiedError);
  });

  it("incomplete (an unreadable row) → unverified; nothing partial is used as the portfolio", () => {
    const raw = { wallet: W, positions: [row(), { side: "yes", shares: "3" }] };
    const r = parsePositionsResult(raw, W);
    expect(r).toMatchObject({ kind: "incomplete", dropped: 1 });
    expect(() => parsePositions(raw, W)).toThrow(/couldn't be verified/);
    try {
      parsePositions(raw, W);
    } catch (e) {
      expect((e as PositionsUnverifiedError).kind).toBe("incomplete");
    }
  });

  it("fetchPositions: malformed 200 rejects (query error), upstream failure rejects; valid empty resolves []", async () => {
    const reply = (status: number, body: unknown) => vi.stubGlobal("fetch", async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    try {
      reply(200, { wallet: W });
      await expect(fetchPositions(W)).rejects.toBeInstanceOf(PositionsUnverifiedError);
      reply(200, { wallet: W, positions: [] });
      await expect(fetchPositions(W)).resolves.toEqual([]);
      reply(502, { code: "UPSTREAM_ERROR" });
      await expect(fetchPositions(W)).rejects.toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("UI read state: failed read never shows empty/zero; failed refresh keeps last verified data labelled stale", () => {
    expect(portfolioReadState({ hasData: false, isError: true })).toBe("failed");
    expect(exposureView("failed", portfolioIntel([]))).toBe("read-failed");
    expect(exposureNote("read-failed")).toBe(POSITIONS_READ_FAILED_NOTE);
    expect(POSITIONS_READ_FAILED_NOTE).toMatch(/couldn't be verified/);
    expect(portfolioReadState({ hasData: true, isError: true })).toBe("stale");
  });
});

describe("trade/claim reconciliation never treats unverified positions as 'nothing there'", () => {
  const SIG = "5".repeat(88);

  it("baseline: a failed positions read leaves the baseline unknown (not 'no shares')", () => {
    expect(positionBaseline(undefined, M, "no")).toEqual({ known: false, shares: null });
    // Previously, malformed → [] → { known: true, shares: null }, which later made an existing row look "reflected".
  });

  it("reconcile with malformed positions every round → stale (never 'reflected'), cache keeps the last verified read", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const previous = parsePositions({ wallet: W, positions: [row({ shares: "10" })] }, W);
    qc.setQueryData(qk.positions(W), previous);
    const ok = onTradeConfirmed(
      qc,
      { signature: SIG, marketId: M, wallet: W, side: "no", amountBase: "1000000" },
      {
        fetchPositions: async () => parsePositions({ wallet: W }, W), // malformed: throws
        fetchTrades: async () => ({ trades: [] }) as never,
        sleep: async () => undefined,
        now: () => Date.now(),
        delays: [0, 0, 0],
      },
    );
    expect(ok).toBe(true);
    for (let i = 0; i < 20 && tradeSession.get(SIG)?.reconcile === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
    const t = tradeSession.get(SIG)!;
    expect(t.baselineKnown).toBe(true);
    expect(t.baselineShares).toBe(10);
    expect(t.reconcile).toBe("stale");
    expect(qc.getQueryData(qk.positions(W))).toEqual(previous); // not overwritten with []
    expect(evaluateReconcile(t, undefined, []).positionReflected).toBe(false);
  });
});

// ---------------------------------------------------------------- 3. embed

const NOW = Date.now();
const nowSec = Math.floor(NOW / 1000);
const market = (over: Partial<Market> = {}): Market => ({
  marketId: "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn",
  title: "Will Dangote list on the NGX by 2027?",
  category: "business",
  phase: "primary",
  status: "primary",
  endTime: nowSec + 30 * 86_400,
  primaryPhaseEndTime: nowSec + 86_400,
  yesPrice: "0.4",
  noPrice: "0.6",
  ...over,
});
const W_ = {
  open: evaluateForecastWindow({ row: market({ sources: { list: true, chain: true, detail: true } }), detail: market(), detailStatus: "ok", nowMs: NOW }),
  secondary: evaluateForecastWindow({ detail: market({ phase: "secondary", status: "secondary", primaryPhaseEndTime: nowSec - 3600 }), detailStatus: "ok", nowMs: NOW }),
  ended: evaluateForecastWindow({ detail: market({ primaryPhaseEndTime: nowSec - 1 }), detailStatus: "ok", nowMs: NOW }),
  cutoff: { open: false, reason: "cutoff_passed", message: "Forecasting closed: the forecast cutoff (end of the primary window) has passed.", cutoffAt: NOW - 1, lifecycle: "ended", checkedAt: NOW } as ForecastWindow,
  resolved: evaluateForecastWindow({ detail: market({ phase: "resolved", resolved: true, outcome: "no" }), detailStatus: "ok", nowMs: NOW }),
  cancelled: evaluateForecastWindow({ detail: market({ phase: "cancelled", status: "cancelled" }), detailStatus: "ok", nowMs: NOW }),
  unknown: evaluateForecastWindow({ detail: market({ phase: "" as Market["phase"], status: undefined }), detailStatus: "ok", nowMs: NOW }),
  unavailable: evaluateForecastWindow({ row: market(), detail: null, detailStatus: "failed", nowMs: NOW }),
  notFound: evaluateForecastWindow({ detail: null, detailStatus: "not_found", nowMs: NOW }),
};
const noSnap = { status: "unavailable" as const, market: null, ageMs: null, sourcesAgreeResolved: null };
const snapOf = (m: Market) => ({ status: "fresh" as const, market: m, ageMs: 0, sourcesAgreeResolved: null, detailOk: true });
const embedModel = (window: ForecastWindow | null, snapshot: Parameters<typeof buildEmbedModel>[0]["snapshot"] = noSnap) =>
  buildEmbedModel({ room: { slug: "test-phantom-sign-in-room", title: "Phantom room" }, origin: "http://localhost:3100", aggregate: emptyAggregate(), finalization: null, snapshot, nowMs: NOW, window });

describe("embed eligibility = room panel = Studio", () => {
  it.each(Object.keys(W_) as (keyof typeof W_)[])("%s: room, Studio and embed agree", (k) => {
    const w = W_[k];
    const room = forecastEligibility(publicWindow(w));
    const studio = forecastingState({ status: "active" } as never, null, w);
    const embed = embedModel(w).forecasting;
    expect([studio, embed]).toEqual([room, room]);
  });

  it("secondary → 'Forecasting closed', no 'Add your forecast'", () => {
    const html = renderEmbed(embedModel(W_.secondary), DEFAULT_EMBED_OPTIONS);
    expect(html).toContain("Forecasting closed");
    expect(html).not.toContain("Add your forecast");
    expect(html).toContain("Open the room on Brief Command");
    expect(html).not.toMatch(/<script/i);
  });

  it("cutoff passed → closed even when the cached snapshot still says primary/open", () => {
    const m = embedModel(W_.cutoff, snapOf(market()));
    expect(m.forecasting).toBe("closed");
    expect(m.forecastingOpen).toBe(false);
  });

  it("unavailable market / no window in time → 'Forecasting paused'", () => {
    for (const w of [W_.unavailable, null]) {
      const m = embedModel(w, snapOf(market()));
      expect(m.forecasting).toBe("unknown");
      const html = renderEmbed(m, DEFAULT_EMBED_OPTIONS);
      expect(html).toContain("Forecasting paused");
      expect(html).not.toContain("Add your forecast");
    }
  });

  it("cached data can only restrict: closed snapshot + open window → closed; open snapshot + closed window → closed", () => {
    expect(embedEligibility(W_.open, "trading", false)).toBe("closed");
    expect(embedEligibility(W_.secondary, "open", false)).toBe("closed");
    expect(embedEligibility(W_.open, "open", true)).toBe("closed"); // resolved
    expect(embedEligibility(W_.open, "open", false)).toBe("open");
    expect(embedEligibility(W_.open, null, false)).toBe("open");
  });
});

describe("embed route uses the shared window (time-budgeted)", () => {
  let embedGET: Handler;
  let repo: SqliteRoomRepository;
  beforeAll(async () => {
    embedGET = (await import("@/app/embed/rooms/[slug]/route")).GET as Handler;
  });
  afterEach(() => {
    __setForecastDepsForTests({});
    __setRoomRepositoryForTests(undefined);
  });
  const seed = async () => {
    repo = new SqliteRoomRepository(tmp());
    __setRoomRepositoryForTests(repo);
    const r = await repo.createRoom(
      { roomId: "room_p7c_000000000001", slug: "p7c-embed-room", title: "P7C embed", description: "", creatorWallet: W, marketId: market().marketId, visibility: "public", status: "active", createdAt: NOW, updatedAt: NOW } as never,
      { key: "p7c-embed-key-000001", fingerprint: "fp" },
    );
    return r.room;
  };
  const get = (slug: string) => embedGET(new NextRequest(`http://localhost/embed/rooms/${slug}`, { headers: { "user-agent": "Mozilla/5.0 p7c", "x-vercel-forwarded-for": `198.18.0.${(++ipSeq % 250) + 1}` } }), { params: Promise.resolve({ slug }) });

  it("secondary window → closed badge", async () => {
    const room = await seed();
    __setForecastDepsForTests({ checkWindow: async () => W_.secondary });
    const html = await (await get(room.slug)).text();
    expect(html).toContain("Forecasting closed");
    expect(html).not.toContain("Add your forecast");
  });

  it("window check slower than the budget → paused (and the widget still answers)", async () => {
    const room = await seed();
    __setForecastDepsForTests({ checkWindow: () => new Promise<ForecastWindow>(() => undefined) });
    const t0 = Date.now();
    const res = await get(room.slug);
    const ms = Date.now() - t0;
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Forecasting paused");
    expect(ms).toBeLessThan(5_000);
  }, 15_000);
});
