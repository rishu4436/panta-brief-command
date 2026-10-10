/**
 * Phase 2 — free community forecasting.
 * Domain validation, both repository adapters (SQLite file + Redis adapter
 * whose Lua script runs in a real Lua VM over an in-memory keyspace), the
 * forecast-window policy, the service and the HTTP route handlers.
 * Wallet keys are generated per test run (legitimate test auth, never product
 * data). No live Upstash is exercised here.
 */
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Market } from "@/lib/panta/domain";
import {
  BUCKET_COUNT,
  REASONING_MAX,
  SubmitForecastInput,
  bucketOf,
  consensusFrom,
  emptyAggregate,
  formatBpsPercent,
  percentToBps,
} from "@/lib/forecasts/domain";
import { ForecastRevisionConflictError, type SubmitForecastCommand } from "@/lib/forecasts/types";
import { evaluateForecastWindow, type ForecastWindow } from "@/lib/forecasts/window";
import { ForecastingClosedError, submitForecast, type ForecastWindowCheck } from "@/lib/forecasts/service";
import { __setForecastDepsForTests } from "@/lib/forecasts/deps";
import { SESSION_COOKIE } from "@/lib/rooms/auth";
import { newRoomId } from "@/lib/rooms/service";
import { SqliteRoomRepository } from "@/lib/rooms/store/sqlite";
import { RedisRoomRepository } from "@/lib/rooms/store/redis";
import { SUBMIT_SCRIPT, scriptBucketMatchesDomain } from "@/lib/rooms/store/redis-forecasts";
import { __setRoomRepositoryForTests, createRoomRepository } from "@/lib/rooms/store";
import { IdempotencyConflictError, RoomNotFoundError, type RoomRepository } from "@/lib/rooms/store/types";
import { FakeRedis } from "./helpers/fake-redis";

// ---------------------------------------------------------------- helpers

const MARKET_A = "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn";

function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  return { address: bs58.encode(raw), signText: (m: string) => bs58.encode(edSign(null, Buffer.from(m, "utf8"), privateKey)) };
}

let tmpDirs: string[] = [];
function tmpDbFile(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "forecast-test-"));
  tmpDirs.push(d);
  return path.join(d, "rooms.sqlite");
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

let keySeq = 0;
const idem = (fp = "fp") => ({ key: `idem-${String(++keySeq).padStart(12, "0")}`, fingerprint: fp });

async function seedRoom(repo: RoomRepository, slug = `room-${Math.random().toString(36).slice(2, 8)}`) {
  const roomId = newRoomId();
  await repo.createRoom(
    { roomId, slug, title: "Haaland room", description: "", creatorWallet: wallet().address, marketId: MARKET_A, visibility: "public", createdAt: Date.now() },
    { key: `room-key-${roomId}`.slice(0, 40), fingerprint: "room" },
  );
  return { roomId, slug };
}

let idSeq = 0;
const cmd = (roomId: string, w: string, bps: number, expectedRevision = 0, over: Partial<SubmitForecastCommand> = {}): SubmitForecastCommand => ({
  roomId,
  wallet: w,
  probabilityBps: bps,
  reasoning: "",
  expectedRevision,
  now: Date.now(),
  newForecastId: `fc_${String(++idSeq).padStart(24, "0")}`,
  ...over,
});

const adapters: [string, () => { repo: RoomRepository; reopen: () => RoomRepository; fake?: FakeRedis }][] = [
  [
    "sqlite",
    () => {
      const file = tmpDbFile();
      return { repo: new SqliteRoomRepository(file), reopen: () => new SqliteRoomRepository(file) };
    },
  ],
  [
    "redis (Lua in VM)",
    () => {
      const fake = new FakeRedis();
      return { repo: new RedisRoomRepository(fake), reopen: () => new RedisRoomRepository(fake), fake };
    },
  ],
];

// ---------------------------------------------------------------- domain

describe("forecast domain validation", () => {
  const base = { roomId: "room_0123456789abcdef01234567", probabilityBps: 6000, reasoning: "Form is good.", expectedRevision: 0, idempotencyKey: "abcdefghijklmnop" };

  it("5. accepts the bounds 0 and 10000", () => {
    expect(SubmitForecastInput.safeParse({ ...base, probabilityBps: 0 }).success).toBe(true);
    expect(SubmitForecastInput.safeParse({ ...base, probabilityBps: 10_000 }).success).toBe(true);
  });

  it("6. rejects negative, >10000, non-integer, string and NaN probabilities", () => {
    for (const p of [-1, 10_001, 50.5, "6000", Number.NaN, null, Infinity]) {
      expect(SubmitForecastInput.safeParse({ ...base, probabilityBps: p }).success, String(p)).toBe(false);
    }
  });

  it("7. reasoning: up to 1000 characters (after cleanup), control/bidi chars stripped", () => {
    expect(SubmitForecastInput.safeParse({ ...base, reasoning: "é".repeat(REASONING_MAX) }).success).toBe(true);
    expect(SubmitForecastInput.safeParse({ ...base, reasoning: "x".repeat(REASONING_MAX + 1) }).success).toBe(false);
    const p = SubmitForecastInput.parse({ ...base, reasoning: "  <b>bold</b>\u202E\u0000 ok  " });
    expect(p.reasoning).toBe("<b>bold</b> ok"); // kept as plain text; React renders it escaped
  });

  it("4. strict schema: a client-named wallet is rejected", () => {
    expect(SubmitForecastInput.safeParse({ ...base, wallet: wallet().address }).success).toBe(false);
  });

  it("buckets, consensus and percent helpers", () => {
    expect([0, 999, 1000, 5000, 9999, 10_000].map(bucketOf)).toEqual([0, 0, 1, 5, 9, 9]);
    for (const b of [0, 1, 999, 1000, 4321, 9999, 10_000]) expect(scriptBucketMatchesDomain(b)).toBe(true);
    expect(consensusFrom(emptyAggregate())).toEqual({ kind: "empty", participants: 0, buckets: Array(BUCKET_COUNT).fill(0) });
    expect(percentToBps("62.5")).toBe(6250);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("100.01")).toBeNull();
    expect(percentToBps("-1")).toBeNull();
    expect(percentToBps("1.234")).toBeNull();
    expect(formatBpsPercent(6250)).toBe("62.5%");
    expect(formatBpsPercent(7000)).toBe("70%");
  });
});

// ---------------------------------------------------------------- repository contract

describe.each(adapters)("forecast repository: %s", (_name, make) => {
  it("1. initial submit creates revision 1 and a history entry", async () => {
    const { repo } = make();
    const { roomId } = await seedRoom(repo);
    const w = wallet().address;
    const res = await repo.submitForecast(cmd(roomId, w, 6500, 0, { reasoning: "Strong fixtures." }), idem());
    expect(res.status).toBe("created");
    expect(res.forecast).toMatchObject({ roomId, wallet: w, probabilityBps: 6500, revision: 1, reasoning: "Strong fixtures." });
    expect(await repo.getCurrentForecast(roomId, w)).toEqual(res.forecast);
    const hist = await repo.getForecastHistory(roomId, w, { limit: 10 });
    expect(hist.map((h) => [h.revision, h.probabilityBps])).toEqual([[1, 6500]]);
  });

  it("8 + 9. revision replaces the current forecast; history is append-only", async () => {
    const { repo } = make();
    const { roomId } = await seedRoom(repo);
    const w = wallet().address;
    const first = await repo.submitForecast(cmd(roomId, w, 4000, 0, { reasoning: "v1", now: 1_000 }), idem());
    const second = await repo.submitForecast(cmd(roomId, w, 5500, 1, { reasoning: "v2", now: 2_000 }), idem());
    const third = await repo.submitForecast(cmd(roomId, w, 7000, 2, { reasoning: "v3", now: 3_000 }), idem());
    expect(second.status).toBe("revised");
    expect(third.forecast).toMatchObject({ forecastId: first.forecast.forecastId, revision: 3, probabilityBps: 7000, createdAt: 1_000, updatedAt: 3_000 });
    const hist = await repo.getForecastHistory(roomId, w, { limit: 10 });
    expect(hist.map((h) => [h.revision, h.probabilityBps, h.reasoning, h.createdAt])).toEqual([
      [3, 7000, "v3", 3_000],
      [2, 5500, "v2", 2_000],
      [1, 4000, "v1", 1_000],
    ]);
    expect(await repo.countForecastParticipants(roomId)).toBe(1);
  });

  it("10. idempotency: same key + payload replays; same key + different payload conflicts", async () => {
    const { repo } = make();
    const { roomId } = await seedRoom(repo);
    const w = wallet().address;
    const key = idem("same");
    const a = await repo.submitForecast(cmd(roomId, w, 6000), key);
    const b = await repo.submitForecast(cmd(roomId, w, 6000), key); // a retry (expectedRevision is now stale)
    expect(b.status).toBe("replayed");
    expect(b.forecast).toMatchObject({ forecastId: a.forecast.forecastId, revision: 1, probabilityBps: 6000 });
    await expect(repo.submitForecast(cmd(roomId, w, 6100), { key: key.key, fingerprint: "other" })).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect((await repo.getForecastHistory(roomId, w, { limit: 10 })).length).toBe(1);
  });

  it("11. concurrent revisions with the same expectedRevision: exactly one wins, the other conflicts", async () => {
    const { repo } = make();
    const { roomId } = await seedRoom(repo);
    const w = wallet().address;
    await repo.submitForecast(cmd(roomId, w, 5000), idem());
    const results = await Promise.allSettled([
      repo.submitForecast(cmd(roomId, w, 6000, 1), idem()),
      repo.submitForecast(cmd(roomId, w, 7000, 1), idem()),
    ]);
    const okRes = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(okRes.length).toBe(1);
    expect(bad.length).toBe(1);
    expect(bad[0].reason).toBeInstanceOf(ForecastRevisionConflictError);
    expect((bad[0].reason as ForecastRevisionConflictError).currentRevision).toBe(2);
    expect((await repo.getForecastHistory(roomId, w, { limit: 10 })).map((h) => h.revision)).toEqual([2, 1]);
    const agg = await repo.getForecastAggregate(roomId);
    expect(agg.participants).toBe(1);
    expect(agg.sumBps).toBe((await repo.getCurrentForecast(roomId, w))!.probabilityBps);
  });

  it("stale expectedRevision and a second 'initial' submit are conflicts", async () => {
    const { repo } = make();
    const { roomId } = await seedRoom(repo);
    const w = wallet().address;
    await repo.submitForecast(cmd(roomId, w, 5000), idem());
    await expect(repo.submitForecast(cmd(roomId, w, 5100, 0), idem())).rejects.toMatchObject({ currentRevision: 1 });
    await expect(repo.submitForecast(cmd(roomId, w, 5100, 5), idem())).rejects.toBeInstanceOf(ForecastRevisionConflictError);
  });

  it("12 + 13 + 14. distinct participants, unweighted mean of current forecasts, revisions replace", async () => {
    const { repo } = make();
    const { roomId } = await seedRoom(repo);
    const [a, b, c] = [wallet().address, wallet().address, wallet().address];
    await repo.submitForecast(cmd(roomId, a, 7000), idem());
    await repo.submitForecast(cmd(roomId, b, 5000), idem());
    await repo.submitForecast(cmd(roomId, c, 6000), idem());
    let cons = consensusFrom(await repo.getForecastAggregate(roomId));
    expect(cons).toMatchObject({ kind: "consensus", participants: 3, meanBps: 6000 });
    // a revises 70 → 40: replaces, not adds (mean (40+50+60)/3 = 50)
    await repo.submitForecast(cmd(roomId, a, 4000, 1), idem());
    await repo.submitForecast(cmd(roomId, a, 4000, 2), idem());
    const agg = await repo.getForecastAggregate(roomId);
    cons = consensusFrom(agg);
    expect(cons).toMatchObject({ kind: "consensus", participants: 3, meanBps: 5000 });
    expect(await repo.countForecastParticipants(roomId)).toBe(3);
    expect(agg.buckets.reduce((x, y) => x + y, 0)).toBe(3);
    expect(agg.buckets[4]).toBe(1);
    expect(agg.buckets[5]).toBe(1);
    expect(agg.buckets[6]).toBe(1);
    expect(agg.buckets[7]).toBe(0);
  });

  it("15. no forecasts: empty consensus, no mean", async () => {
    const { repo } = make();
    const { roomId } = await seedRoom(repo);
    const cons = consensusFrom(await repo.getForecastAggregate(roomId));
    expect(cons.kind).toBe("empty");
    expect("meanBps" in cons).toBe(false);
    expect(await repo.listCurrentForecasts(roomId, { limit: 10, offset: 0 })).toEqual({ items: [], total: 0 });
  });

  it("21. persistence across a new repository instance (restart)", async () => {
    const { repo, reopen } = make();
    const { roomId } = await seedRoom(repo);
    const w = wallet().address;
    await repo.submitForecast(cmd(roomId, w, 3300), idem());
    await repo.submitForecast(cmd(roomId, w, 3500, 1), idem());
    const again = reopen();
    expect((await again.getCurrentForecast(roomId, w))?.probabilityBps).toBe(3500);
    expect((await again.getForecastHistory(roomId, w, { limit: 10 })).length).toBe(2);
    expect(consensusFrom(await again.getForecastAggregate(roomId))).toMatchObject({ meanBps: 3500, participants: 1 });
  });

  it("22. public listing is paginated and bounded, newest update first", async () => {
    const { repo } = make();
    const { roomId } = await seedRoom(repo);
    const ws = Array.from({ length: 7 }, () => wallet().address);
    for (const [i, w] of ws.entries()) await repo.submitForecast(cmd(roomId, w, 1000 + i * 100, 0, { now: 10_000 + i }), idem());
    const p1 = await repo.listCurrentForecasts(roomId, { limit: 3, offset: 0 });
    const p2 = await repo.listCurrentForecasts(roomId, { limit: 3, offset: 3 });
    const p3 = await repo.listCurrentForecasts(roomId, { limit: 3, offset: 6 });
    expect(p1.total).toBe(7);
    expect(p1.items.map((f) => f.wallet)).toEqual([ws[6], ws[5], ws[4]]);
    expect(p2.items.map((f) => f.wallet)).toEqual([ws[3], ws[2], ws[1]]);
    expect(p3.items.map((f) => f.wallet)).toEqual([ws[0]]);
  });

  it("23. rooms are isolated", async () => {
    const { repo } = make();
    const r1 = await seedRoom(repo);
    const r2 = await seedRoom(repo);
    const w = wallet().address;
    await repo.submitForecast(cmd(r1.roomId, w, 8000), idem());
    expect(await repo.getCurrentForecast(r2.roomId, w)).toBeNull();
    expect(await repo.countForecastParticipants(r2.roomId)).toBe(0);
    const second = await repo.submitForecast(cmd(r2.roomId, w, 2000), idem());
    expect(second.forecast.revision).toBe(1);
    expect(consensusFrom(await repo.getForecastAggregate(r1.roomId))).toMatchObject({ meanBps: 8000 });
    expect(consensusFrom(await repo.getForecastAggregate(r2.roomId))).toMatchObject({ meanBps: 2000 });
  });

  it("unknown room is rejected without writing", async () => {
    const { repo } = make();
    await expect(repo.submitForecast(cmd(newRoomId(), wallet().address, 5000), idem())).rejects.toBeInstanceOf(RoomNotFoundError);
  });
});

describe("storage-level guarantees", () => {
  it("SQLite: history rows can't be updated or deleted; current is UNIQUE (room, wallet)", async () => {
    const file = tmpDbFile();
    const repo = new SqliteRoomRepository(file);
    const { roomId } = await seedRoom(repo);
    const w = wallet().address;
    await repo.submitForecast(cmd(roomId, w, 5000), idem());
    const initSqlJs = (await import("sql.js")).default;
    const { readFileSync } = await import("node:fs");
    const SQL = await initSqlJs({ wasmBinary: readFileSync(path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm")).buffer as ArrayBuffer });
    const db = new SQL.Database(readFileSync(file));
    expect(() => db.run("UPDATE forecast_revisions SET probability_bps = 1")).toThrow(/immutable/);
    expect(() => db.run("DELETE FROM forecast_revisions")).toThrow(/immutable/);
    expect(() =>
      db.run("INSERT INTO forecasts VALUES ('fc_x', ?, ?, 1, '', 1, 0, 0)", [roomId, w]),
    ).toThrow(/UNIQUE/);
    expect(() => db.run("INSERT INTO forecasts VALUES ('fc_y', ?, 'other', 10001, '', 1, 0, 0)", [roomId])).toThrow(/CHECK/);
    db.close();
  });

  it("Redis: the submit is one Lua script; a failed script saves nothing", async () => {
    const fake = new FakeRedis();
    const repo = new RedisRoomRepository(fake);
    const { roomId } = await seedRoom(repo);
    const w = wallet().address;
    fake.failEval = true;
    await expect(repo.submitForecast(cmd(roomId, w, 5000), idem())).rejects.toMatchObject({ name: "RoomStoreUnavailableError" });
    fake.failEval = false;
    expect(await repo.getCurrentForecast(roomId, w)).toBeNull();
    await repo.submitForecast(cmd(roomId, w, 5000), idem());
    expect(fake.evalCalls).toBe(2);
    expect(SUBMIT_SCRIPT).toContain("CONFLICT");
  });

  it("unavailable store (production without DB) fails closed for forecasts too", async () => {
    const repo = createRoomRepository({ kind: "unavailable", reason: "test" });
    await expect(repo.submitForecast(cmd(newRoomId(), wallet().address, 5000), idem())).rejects.toMatchObject({ reason: "unconfigured" });
    await expect(repo.getForecastAggregate(newRoomId())).rejects.toMatchObject({ reason: "unconfigured" });
  });
});

// ---------------------------------------------------------------- forecast window policy

const NOW = Date.UTC(2026, 9, 10, 10, 0, 0);
const nowSec = Math.floor(NOW / 1000);
const market = (over: Partial<Market> = {}): Market => ({
  marketId: MARKET_A,
  title: "Haaland 8+ points, GW6",
  category: "sports",
  phase: "primary",
  status: "primary",
  endTime: nowSec + 30 * 3600,
  primaryPhaseEndTime: nowSec + 19 * 3600,
  yesPrice: "0.4",
  noPrice: "0.6",
  ...over,
});

describe("forecast window (cutoff policy)", () => {
  it("open primary market before the cutoff is open; cutoff = primaryPhaseEndTime", () => {
    const w = evaluateForecastWindow({ row: market({ sources: { list: true, chain: true, detail: true } }), detail: market(), detailStatus: "ok", nowMs: NOW });
    expect(w).toMatchObject({ open: true, cutoffAt: (nowSec + 19 * 3600) * 1000 });
  });

  it("16. closed: primary window passed / event ended", () => {
    expect(evaluateForecastWindow({ detail: market({ primaryPhaseEndTime: nowSec - 1 }), detailStatus: "ok", nowMs: NOW })).toMatchObject({ open: false, reason: "ended" });
    expect(evaluateForecastWindow({ detail: market({ endTime: nowSec - 1 }), detailStatus: "ok", nowMs: NOW })).toMatchObject({ open: false, reason: "ended" });
    expect(evaluateForecastWindow({ detail: market({ phase: "secondary", status: "secondary" }), detailStatus: "ok", nowMs: NOW })).toMatchObject({
      open: false,
      reason: "secondary",
    });
  });

  it("17. resolved is closed", () => {
    expect(evaluateForecastWindow({ detail: market({ phase: "resolved", resolved: true, outcome: "yes" }), detailStatus: "ok", nowMs: NOW })).toMatchObject({
      open: false,
      reason: "resolved",
    });
  });

  it("18. cancelled is closed", () => {
    expect(evaluateForecastWindow({ detail: market({ phase: "cancelled", status: "cancelled" }), detailStatus: "ok", nowMs: NOW })).toMatchObject({
      open: false,
      reason: "cancelled",
    });
  });

  it("19. unknown phase, missing cutoff, Panta unavailable, not found: all closed (fail closed)", () => {
    expect(evaluateForecastWindow({ detail: market({ phase: "" as Market["phase"], status: undefined }), detailStatus: "ok", nowMs: NOW })).toMatchObject({ open: false, reason: "unknown" });
    expect(evaluateForecastWindow({ detail: market({ primaryPhaseEndTime: null }), detailStatus: "ok", nowMs: NOW })).toMatchObject({ open: false, reason: "no_cutoff" });
    expect(evaluateForecastWindow({ row: market(), detail: null, detailStatus: "failed", nowMs: NOW })).toMatchObject({ open: false, reason: "unavailable" });
    expect(evaluateForecastWindow({ detail: null, detailStatus: "not_found", nowMs: NOW })).toMatchObject({ open: false, reason: "not_found" });
    // partial detail (stale phase possible) and no catalog row: can't confirm open
    expect(evaluateForecastWindow({ detail: market({ title: "", yesPrice: null, noPrice: null, partial: true }), detailStatus: "ok", nowMs: NOW })).toMatchObject({
      open: false,
      reason: "unavailable",
    });
  });

  it("a stale catalog row can't re-open a market the fresh record shows closed (and vice versa)", () => {
    const staleOpenRow = market({ sources: { list: true, chain: true, detail: true } });
    expect(evaluateForecastWindow({ row: staleOpenRow, detail: market({ phase: "resolved", resolved: true }), detailStatus: "ok", nowMs: NOW })).toMatchObject({
      open: false,
      reason: "resolved",
    });
    const chainSecondary = market({ phase: "secondary", status: "secondary", sources: { list: true, chain: true, detail: false } });
    expect(evaluateForecastWindow({ row: chainSecondary, detail: market(), detailStatus: "ok", nowMs: NOW })).toMatchObject({ open: false, reason: "secondary" });
    // earliest cutoff across sources wins
    const w = evaluateForecastWindow({ row: market({ primaryPhaseEndTime: nowSec + 600 }), detail: market(), detailStatus: "ok", nowMs: NOW });
    expect(w).toMatchObject({ open: true, cutoffAt: (nowSec + 600) * 1000 });
  });
});

// ---------------------------------------------------------------- service

describe("forecast service", () => {
  it("blocked window: nothing is written", async () => {
    const repo = new SqliteRoomRepository(tmpDbFile());
    const { roomId, slug } = await seedRoom(repo);
    const room = (await repo.getRoomBySlug(slug))!;
    const w = wallet().address;
    const closed: ForecastWindowCheck = async (_m, nowMs) => evaluateForecastWindow({ detail: market({ phase: "resolved", resolved: true }), detailStatus: "ok", nowMs });
    const input = SubmitForecastInput.parse({ roomId, probabilityBps: 5000, expectedRevision: 0, idempotencyKey: "svc-key-0000000000" });
    await expect(submitForecast({ repo, checkWindow: closed, now: () => NOW }, w, room, input)).rejects.toBeInstanceOf(ForecastingClosedError);
    expect(await repo.getCurrentForecast(roomId, w)).toBeNull();
  });
});

// ---------------------------------------------------------------- HTTP routes

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
let routes: { challenge: Handler; verify: Handler; createRoom: Handler; get: Handler; post: Handler; me: Handler };

let ipSeq = 0;
function req(url: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "x-vercel-forwarded-for": `203.0.113.${(++ipSeq % 250) + 1}` };
  if (init.origin !== null) headers.origin = init.origin ?? "http://localhost";
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function signIn(w = wallet()) {
  const c = await routes.challenge(req("/api/rooms/auth/challenge", { method: "POST", body: { wallet: w.address } }));
  const { nonce, message } = (await c.json()) as { nonce: string; message: string };
  const v = await routes.verify(req("/api/rooms/auth/verify", { method: "POST", body: { nonce, signature: w.signText(message) } }));
  expect(v.status).toBe(200);
  return { cookie: (v.headers.get("set-cookie") || "").split(";")[0], address: w.address };
}

let windowState: ForecastWindow | "throw" = { open: true, cutoffAt: NOW + 3600_000, lifecycle: "open", checkedAt: NOW };

describe("forecast HTTP API", () => {
  let repo: SqliteRoomRepository;
  let slug: string;
  let roomId: string;

  beforeAll(async () => {
    routes = {
      challenge: (await import("@/app/api/rooms/auth/challenge/route")).POST as Handler,
      verify: (await import("@/app/api/rooms/auth/verify/route")).POST as Handler,
      createRoom: (await import("@/app/api/rooms/route")).POST as Handler,
      get: (await import("@/app/api/rooms/[slug]/forecasts/route")).GET as Handler,
      post: (await import("@/app/api/rooms/[slug]/forecasts/route")).POST as Handler,
      me: (await import("@/app/api/rooms/[slug]/forecasts/me/route")).GET as Handler,
    };
  });
  beforeEach(async () => {
    repo = new SqliteRoomRepository(tmpDbFile());
    __setRoomRepositoryForTests(repo);
    windowState = { open: true, cutoffAt: NOW + 3600_000, lifecycle: "open", checkedAt: NOW };
    __setForecastDepsForTests({
      checkWindow: async () => {
        if (windowState === "throw") throw new Error("should not be called");
        return windowState;
      },
      now: () => NOW,
    });
    ({ roomId, slug } = await seedRoom(repo, "haaland-room"));
  });
  afterEach(() => {
    __setRoomRepositoryForTests(undefined);
    __setForecastDepsForTests({});
  });

  let keyN = 0;
  const body = (over: Record<string, unknown> = {}) => ({
    roomId,
    probabilityBps: 6000,
    reasoning: "",
    expectedRevision: 0,
    idempotencyKey: `http-key-${String(++keyN).padStart(10, "0")}`,
    ...over,
  });
  const post = (b: unknown, cookie?: string, origin?: string | null) => routes.post(req(`/api/rooms/${slug}/forecasts`, { method: "POST", body: b, cookie, origin }), ctx(slug));

  it("1 + 2. submit binds to the session wallet; GET shows community forecast; /me shows history", async () => {
    const { cookie, address } = await signIn();
    const r = await post(body({ probabilityBps: 6250, reasoning: "<script>alert(1)</script> form" }), cookie);
    expect(r.status).toBe(201);
    const j = (await r.json()) as { status: string; forecast: { wallet: string; probabilityBps: number; revision: number; reasoning: string; updatedAt: string } };
    expect(j.status).toBe("created");
    expect(j.forecast).toMatchObject({ wallet: address, probabilityBps: 6250, revision: 1 });
    expect(j.forecast.reasoning).toBe("<script>alert(1)</script> form"); // stored as text, rendered escaped
    expect(j.forecast.updatedAt).toBe(new Date(NOW).toISOString()); // server timestamp

    const g = (await (await routes.get(req(`/api/rooms/${slug}/forecasts`), ctx(slug))).json()) as Record<string, unknown>;
    expect(g.consensus).toMatchObject({ kind: "consensus", participants: 1, meanBps: 6250 });
    expect(g.window).toMatchObject({ open: true, cutoffAt: new Date(NOW + 3600_000).toISOString() });
    const text = JSON.stringify(g);
    expect(text).not.toMatch(/nonce|session|signature|cookie/i);

    const me = (await (await routes.me(req(`/api/rooms/${slug}/forecasts/me`, { cookie }), ctx(slug))).json()) as {
      wallet: string;
      current: { revision: number };
      history: { revision: number; probabilityBps: number }[];
    };
    expect(me.wallet).toBe(address);
    expect(me.history).toEqual([{ revision: 1, probabilityBps: 6250, reasoning: "<script>alert(1)</script> form", createdAt: new Date(NOW).toISOString() }]);
    const anonMe = (await (await routes.me(req(`/api/rooms/${slug}/forecasts/me`), ctx(slug))).json()) as { wallet: null };
    expect(anonMe.wallet).toBeNull();
  });

  it("3. unauthenticated → 401; forged cookie → 401", async () => {
    expect((await post(body())).status).toBe(401);
    const forged = `${SESSION_COOKIE}=v1.${Buffer.from(JSON.stringify({ v: 1, w: wallet().address, iat: 0, exp: 9e15 })).toString("base64url")}.AAAA`;
    expect((await post(body(), forged)).status).toBe(401);
  });

  it("4. a body naming a wallet is rejected (400) and nothing is saved", async () => {
    const { cookie, address } = await signIn();
    const other = wallet().address;
    for (const key of ["wallet", "walletAddress", "creatorWallet"]) {
      const r = await post(body({ [key]: other }), cookie);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { code: string }).code).toBe("CLIENT_WALLET_REJECTED");
    }
    expect(await repo.getCurrentForecast(roomId, other)).toBeNull();
    expect(await repo.getCurrentForecast(roomId, address)).toBeNull();
  });

  it("5 + 6 + 7. bounds accepted; invalid probabilities and long reasoning → 400", async () => {
    const a = await signIn();
    expect((await post(body({ probabilityBps: 0 }), a.cookie)).status).toBe(201);
    const b = await signIn();
    expect((await post(body({ probabilityBps: 10_000 }), b.cookie)).status).toBe(201);
    const c = await signIn();
    for (const p of [-1, 10_001, 12.5, "5000", null]) {
      const r = await post(body({ probabilityBps: p }), c.cookie);
      expect(r.status, String(p)).toBe(400);
      expect(((await r.json()) as { code: string }).code).toBe("INVALID_FORECAST");
    }
    expect((await post(body({ reasoning: "x".repeat(1001) }), c.cookie)).status).toBe(400);
    expect((await post(body({ roomId: "room_ffffffffffffffffffffffff" }), c.cookie)).status).toBe(400); // other room id
    expect((await post(body({ roomId: "nope" }), c.cookie)).status).toBe(400);
  });

  it("8 + 10 + 11. revision, idempotent retry, lost-update conflict over HTTP", async () => {
    const { cookie } = await signIn();
    const first = body({ probabilityBps: 5000 });
    expect((await post(first, cookie)).status).toBe(201);
    const retry = await post(first, cookie);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { status: string }).status).toBe("replayed");
    const rev = await post(body({ probabilityBps: 5500, expectedRevision: 1 }), cookie);
    expect(rev.status).toBe(200);
    expect(((await rev.json()) as { status: string; forecast: { revision: number } })).toMatchObject({ status: "revised", forecast: { revision: 2 } });
    const stale = await post(body({ probabilityBps: 9000, expectedRevision: 1 }), cookie);
    expect(stale.status).toBe(409);
    expect((await stale.json()) as { code: string; currentRevision: number }).toMatchObject({ code: "FORECAST_REVISION_CONFLICT", currentRevision: 2 });
  });

  it("13. mean of 70/50/60 = 60 from three wallets; creator has no special powers", async () => {
    for (const bps of [7000, 5000, 6000]) {
      const s = await signIn();
      expect((await post(body({ probabilityBps: bps }), s.cookie)).status).toBe(201);
    }
    const g = (await (await routes.get(req(`/api/rooms/${slug}/forecasts?limit=2`), ctx(slug))).json()) as { consensus: { meanBps: number; participants: number }; forecasts: unknown[]; total: number };
    expect(g.consensus).toMatchObject({ meanBps: 6000, participants: 3 });
    expect(g.forecasts.length).toBe(2);
    expect(g.total).toBe(3);
  });

  it("16-19. closed / resolved / cancelled / unknown / unavailable windows block writes; reads still work (20)", async () => {
    const { cookie, address } = await signIn();
    expect((await post(body({ probabilityBps: 4200 }), cookie)).status).toBe(201);
    const cases: [ForecastWindow, number, string][] = [
      [evaluateForecastWindow({ detail: market({ primaryPhaseEndTime: nowSec - 5 }), detailStatus: "ok", nowMs: NOW }), 409, "FORECASTING_CLOSED"],
      [evaluateForecastWindow({ detail: market({ phase: "resolved", resolved: true }), detailStatus: "ok", nowMs: NOW }), 409, "FORECASTING_CLOSED"],
      [evaluateForecastWindow({ detail: market({ phase: "cancelled", status: "cancelled" }), detailStatus: "ok", nowMs: NOW }), 409, "FORECASTING_CLOSED"],
      [evaluateForecastWindow({ detail: market({ phase: "" as Market["phase"], status: undefined }), detailStatus: "ok", nowMs: NOW }), 409, "FORECASTING_CLOSED"],
      [evaluateForecastWindow({ detail: null, detailStatus: "failed", nowMs: NOW }), 503, "FORECAST_WINDOW_UNAVAILABLE"],
    ];
    for (const [w, status, code] of cases) {
      windowState = w;
      const r = await post(body({ probabilityBps: 9100, expectedRevision: 1 }), cookie);
      expect(r.status, JSON.stringify(w)).toBe(status);
      expect(((await r.json()) as { code: string }).code).toBe(code);
    }
    expect((await repo.getCurrentForecast(roomId, address))?.probabilityBps).toBe(4200);
    // 20: after closure the history and consensus stay readable
    const me = (await (await routes.me(req(`/api/rooms/${slug}/forecasts/me`, { cookie }), ctx(slug))).json()) as { history: unknown[] };
    expect(me.history.length).toBe(1);
    const g = (await (await routes.get(req(`/api/rooms/${slug}/forecasts`), ctx(slug))).json()) as { consensus: { meanBps: number }; window: { open: boolean; reason: string } };
    expect(g.consensus.meanBps).toBe(4200);
    expect(g.window).toMatchObject({ open: false, reason: "unavailable" });
  });

  it("cross-origin and missing room are rejected; unconfigured store → 503", async () => {
    const { cookie } = await signIn();
    expect((await post(body(), cookie, "https://evil.example")).status).toBe(403);
    expect((await post(body(), cookie, null)).status).toBe(403);
    expect((await routes.post(req(`/api/rooms/missing-room/forecasts`, { method: "POST", body: body(), cookie }), ctx("missing-room"))).status).toBe(404);
    expect((await routes.get(req(`/api/rooms/missing-room/forecasts`), ctx("missing-room"))).status).toBe(404);
    __setRoomRepositoryForTests(createRoomRepository({ kind: "unavailable", reason: "test" }));
    expect((await routes.get(req(`/api/rooms/${slug}/forecasts`), ctx(slug))).status).toBe(503);
    expect((await post(body(), cookie)).status).toBe(503);
  });

  it("24. Phase 1 auth regression: room creation still needs the verified session", async () => {
    const anon = await routes.createRoom(req("/api/rooms", { method: "POST", body: { title: "No auth room", slug: "no-auth-room", marketId: MARKET_A, idempotencyKey: "no-auth-key-00000000" } }));
    expect(anon.status).toBe(401);
    const { cookie } = await signIn();
    const replay = await routes.verify(req("/api/rooms/auth/verify", { method: "POST", body: { nonce: "a".repeat(32), signature: "1".repeat(64) } }));
    expect(replay.status).toBe(401);
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  });
});
