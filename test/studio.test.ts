/**
 * Creator Growth Studio (Phase 6). Storage is real (SQLite file and the Redis
 * adapter's actual Lua in fengari) and every parity test runs the same
 * scenario on both. Panta is never called: market snapshots are injected.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "@/lib/embed/market-snapshot";
import { __resetSnapshotCacheForTests } from "@/lib/embed/market-snapshot";
import { submitForecast } from "@/lib/forecasts/service";
import { SESSION_COOKIE, sessionSecret, signSession } from "@/lib/rooms/auth";
import type { RoomRecord } from "@/lib/rooms/domain";
import { newRoomId } from "@/lib/rooms/service";
import { __setRoomRepositoryForTests } from "@/lib/rooms/store";
import { RedisRoomRepository, ROOMS_REDIS_PREFIX } from "@/lib/rooms/store/redis";
import { studioKeys } from "@/lib/rooms/store/redis-studio";
import { SqliteRoomRepository } from "@/lib/rooms/store/sqlite";
import { RoomForbiddenError, type RoomRepository } from "@/lib/rooms/store/types";
import {
  ANALYTICS_RETENTION_DAYS,
  campaignUrl,
  MAX_DYNAMIC_FIELDS_PER_ROOM_DAY,
  METRIC,
  NOT_TRACKED,
  recentDays,
  utcDay,
} from "@/lib/studio/domain";
import { cleanHost, dedupeKey, skipReason, sourceMetric } from "@/lib/studio/events";
import { __setStudioSnapshotForTests } from "@/lib/studio/http";
import { buildInsights, type InsightInput } from "@/lib/studio/insights";
import { getStudioOverview, getStudioRoom, listStudioRooms, summarizeDistribution, type StudioDeps } from "@/lib/studio/service";
import { FakeRedis } from "./helpers/fake-redis";

// ---------------------------------------------------------------- fixtures

const MARKET = "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn";
const MARKET2 = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const DAY = 86_400_000;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const newWallet = () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  return bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url"));
};

let tmpDirs: string[] = [];
function tmpDb() {
  const d = mkdtempSync(path.join(os.tmpdir(), "studio-test-"));
  tmpDirs.push(d);
  return path.join(d, "rooms.sqlite");
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

type Made = { name: string; repo: RoomRepository; fake: FakeRedis | null; file: string | null };
const factories = [
  { name: "sqlite", make: (): Made => {
    const f = tmpDb();
    return { name: "sqlite", repo: new SqliteRoomRepository(f), fake: null, file: f };
  } },
  { name: "redis (fengari Lua)", make: (): Made => {
    const r = new FakeRedis();
    return { name: "redis", repo: new RedisRoomRepository(r), fake: r, file: null };
  } },
];

let seq = 0;
async function seedRoom(repo: RoomRepository, creator: string, over: Partial<RoomRecord> = {}): Promise<RoomRecord> {
  const roomId = newRoomId();
  const slug = over.slug ?? `studio-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await repo.createRoom(
    {
      roomId,
      slug,
      title: over.title ?? `Room ${seq}`,
      description: over.description ?? "",
      creatorWallet: creator,
      marketId: over.marketId ?? MARKET,
      visibility: over.visibility ?? "public",
      status: over.status ?? "active",
      createdAt: over.createdAt ?? NOW - 5 * DAY + seq,
    },
    { key: `room-key-${roomId}`.slice(0, 40), fingerprint: "room" },
  );
  return (await repo.getRoomById(roomId))!;
}

let idem = 0;
const fdeps = (repo: RoomRepository, at: number) => ({
  repo,
  now: () => at,
  checkWindow: async () => ({ open: true as const, cutoffAt: at + 10 * DAY, lifecycle: "open" as const, checkedAt: at }),
});
async function forecast(repo: RoomRepository, room: RoomRecord, wallet: string, bps: number, at: number, expectedRevision = 0) {
  return submitForecast(fdeps(repo, at), wallet, room, { roomId: room.roomId, probabilityBps: bps, reasoning: "", expectedRevision, idempotencyKey: `studio-idem-${String(++idem).padStart(8, "0")}` });
}
/** Durable write WITHOUT the Studio note (data that existed before Phase 6). */
async function rawForecast(repo: RoomRepository, room: RoomRecord, wallet: string, bps: number, at: number, expectedRevision = 0) {
  await repo.noteParticipation({ wallet, roomId: room.roomId, marketId: room.marketId, at });
  return repo.submitForecast(
    { roomId: room.roomId, wallet, probabilityBps: bps, reasoning: "", expectedRevision, now: at, newForecastId: `fc_${(++idem).toString(16).padStart(24, "0")}` },
    { key: `studio-raw-${String(idem).padStart(8, "0")}`, fingerprint: `fp-${idem}` },
  );
}

const unavailableSnap = async (): Promise<MarketSnapshot> =>
  ({ status: "unavailable", market: null, ageMs: null, sourcesAgreeResolved: null, chainOk: false, detailOk: false, fetchedAt: null }) as MarketSnapshot;
const deps = (repo: RoomRepository, now = NOW): StudioDeps => ({ repo, now: () => now, origin: "http://localhost:3100", snapshot: unavailableSnap });

let ipSeq = 0;
function req(url: string, init: { method?: string; body?: unknown; rawBody?: string; cookie?: string; origin?: string | null; ip?: string; ua?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "x-vercel-forwarded-for": init.ip ?? `10.9.${++ipSeq % 250}.${Math.floor(ipSeq / 250) % 250}` };
  if (init.ua !== null) headers["user-agent"] = init.ua ?? UA;
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== null && (init.method ?? "GET") !== "GET") headers.origin = init.origin ?? "http://localhost";
  Object.assign(headers, init.headers ?? {});
  const body = init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined);
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers, body });
}
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const cookieFor = (wallet: string) => `${SESSION_COOKIE}=${signSession(wallet, Date.now(), sessionSecret()!).value}`;

type Handler = (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
let overviewGET: (req: NextRequest) => Promise<Response>;
let roomsGET: (req: NextRequest) => Promise<Response>;
let studioRoomGET: Handler;
let roomPATCH: Handler;
let roomGET: Handler;
let eventsPOST: Handler;
let embedGET: Handler;
let roomsListGET: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  overviewGET = (await import("@/app/api/studio/overview/route")).GET;
  roomsGET = (await import("@/app/api/studio/rooms/route")).GET;
  studioRoomGET = (await import("@/app/api/studio/rooms/[slug]/route")).GET as Handler;
  const r = await import("@/app/api/rooms/[slug]/route");
  roomPATCH = r.PATCH as Handler;
  roomGET = r.GET as Handler;
  eventsPOST = (await import("@/app/api/rooms/[slug]/events/route")).POST as Handler;
  embedGET = (await import("@/app/embed/rooms/[slug]/route")).GET as Handler;
  roomsListGET = (await import("@/app/api/rooms/route")).GET as (req: NextRequest) => Promise<Response>;
  __setStudioSnapshotForTests(unavailableSnap);
});
afterAll(() => {
  __setStudioSnapshotForTests(undefined);
  __setRoomRepositoryForTests(undefined);
});

const beacon = (slug: string, body: Record<string, unknown> = {}, init: Parameters<typeof req>[1] = {}) =>
  eventsPOST(req(`/api/rooms/${slug}/events`, { method: "POST", body: { schemaVersion: 1, event: "room_view", ...body }, ...init }), ctx(slug));
const today = () => utcDay(Date.now());
const counters = async (repo: RoomRepository, creator: string) => repo.listStudioCounters(creator, { days: [today()] });
const count = (rows: { roomId: string; metric: string; count: number }[], roomId: string, metric: string) => rows.find((r) => r.roomId === roomId && r.metric === metric)?.count ?? 0;

// ---------------------------------------------------------------- 1–6 access & ownership (routes)

describe.each(factories)("studio access & ownership: $name", ({ make }) => {
  let m: Made;
  beforeEach(() => {
    m = make();
    __setRoomRepositoryForTests(m.repo);
  });
  afterEach(() => __setRoomRepositoryForTests(undefined));

  it("1. every Studio API needs a verified session (none, forged and expired cookies are 401)", async () => {
    const a = newWallet();
    const room = await seedRoom(m.repo, a);
    const forged = `${SESSION_COOKIE}=${signSession(a, Date.now(), "x".repeat(40)).value}`;
    const expired = `${SESSION_COOKIE}=${signSession(a, Date.now() - 400 * DAY, sessionSecret()!).value}`;
    for (const cookie of [undefined, forged, expired]) {
      expect((await overviewGET(req("/api/studio/overview", { cookie }))).status).toBe(401);
      expect((await roomsGET(req("/api/studio/rooms", { cookie }))).status).toBe(401);
      expect((await studioRoomGET(req(`/api/studio/rooms/${room.slug}`, { cookie }), ctx(room.slug))).status).toBe(401);
    }
    const ok = await overviewGET(req("/api/studio/overview", { cookie: cookieFor(a) }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("2. a creator sees only their own rooms (any status); a client-supplied wallet is ignored", async () => {
    const a = newWallet();
    const b = newWallet();
    await seedRoom(m.repo, a, { title: "A public" });
    await seedRoom(m.repo, a, { title: "A unlisted", visibility: "unlisted" });
    await seedRoom(m.repo, a, { title: "A archived", status: "archived" });
    await seedRoom(m.repo, b, { title: "B room" });
    const res = await roomsGET(req(`/api/studio/rooms?wallet=${b}`, { cookie: cookieFor(a), headers: { "x-wallet": b } }));
    const page = (await res.json()) as { items: { title: string }[]; total: number };
    expect(page.total).toBe(3);
    expect(page.items.map((r) => r.title).sort()).toEqual(["A archived", "A public", "A unlisted"]);
    const ov = (await (await overviewGET(req(`/api/studio/overview?wallet=${b}`, { cookie: cookieFor(a) }))).json()) as { wallet: string; rooms: { total: number; archived: number } };
    expect(ov.wallet).toBe(a);
    expect(ov.rooms).toMatchObject({ total: 3, archived: 1 });
  });

  it("3. another creator's room (active, unlisted or archived) answers the same 404 as a missing one", async () => {
    const a = newWallet();
    const b = newWallet();
    const rooms = [await seedRoom(m.repo, b), await seedRoom(m.repo, b, { visibility: "unlisted" }), await seedRoom(m.repo, b, { status: "archived" })];
    const missing = await studioRoomGET(req("/api/studio/rooms/no-such-room", { cookie: cookieFor(a) }), ctx("no-such-room"));
    const missingBody = await missing.json();
    for (const r of rooms) {
      const res = await studioRoomGET(req(`/api/studio/rooms/${r.slug}`, { cookie: cookieFor(a) }), ctx(r.slug));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(missingBody);
    }
    const own = await studioRoomGET(req(`/api/studio/rooms/${rooms[2].slug}`, { cookie: cookieFor(b) }), ctx(rooms[2].slug));
    expect(own.status).toBe(200);
  });

  it("4. PATCH settings: creator only, same-origin only, market and slug immutable", async () => {
    const a = newWallet();
    const room = await seedRoom(m.repo, a);
    const patch = (body: unknown, init: Parameters<typeof req>[1] = {}) => roomPATCH(req(`/api/rooms/${room.slug}`, { method: "PATCH", body, cookie: cookieFor(a), ...init }), ctx(room.slug));
    expect((await patch({ visibility: "unlisted" }, { cookie: undefined })).status).toBe(401);
    expect((await patch({ visibility: "unlisted" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await patch({ visibility: "unlisted" }, { origin: null })).status).toBe(403);
    expect((await patch({ visibility: "unlisted" }, { cookie: cookieFor(newWallet()) })).status).toBe(403);
    expect((await patch({ marketId: MARKET2 })).status).toBe(400);
    expect((await patch({ slug: "new-slug" })).status).toBe(400);
    expect((await patch({ creatorWallet: newWallet() })).status).toBe(400);
    expect((await patch({ status: "deleted" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    const res = await patch({ visibility: "unlisted", title: "Renamed room" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { room: RoomRecord };
    expect(body.room).toMatchObject({ visibility: "unlisted", title: "Renamed room", marketId: MARKET, slug: room.slug, status: "active" });
    await expect(m.repo.updateRoom(room.roomId, newWallet(), { status: "archived" }, NOW)).rejects.toBeInstanceOf(RoomForbiddenError);
  });

  it("5. archive hides the room from everyone else, keeps history, and unarchive restores it", async () => {
    const a = newWallet();
    const w = newWallet();
    const room = await seedRoom(m.repo, a);
    await forecast(m.repo, room, w, 6000, NOW);
    const archive = await roomPATCH(req(`/api/rooms/${room.slug}`, { method: "PATCH", body: { status: "archived" }, cookie: cookieFor(a) }), ctx(room.slug));
    expect(archive.status).toBe(200);
    expect((await roomGET(req(`/api/rooms/${room.slug}`), ctx(room.slug))).status).toBe(404);
    expect((await embedGET(req(`/embed/rooms/${room.slug}`), ctx(room.slug))).status).toBe(404);
    const list = (await (await roomsListGET(req("/api/rooms?limit=50"))).json()) as { rooms: { slug: string }[] };
    expect(list.rooms.map((r) => r.slug)).not.toContain(room.slug);
    // non-creators can't learn it exists through PATCH either
    expect((await roomPATCH(req(`/api/rooms/${room.slug}`, { method: "PATCH", body: { title: "Hijack" }, cookie: cookieFor(newWallet()) }), ctx(room.slug))).status).toBe(404);
    // no new forecasts (store-level check), history intact
    await expect(forecast(m.repo, room, newWallet(), 5000, NOW + 1)).rejects.toThrow();
    expect((await m.repo.getCurrentForecast(room.roomId, w))?.probabilityBps).toBe(6000);
    // the creator still sees it in the Studio with its numbers
    const s = await getStudioRoom(deps(m.repo), a, room.slug);
    expect(s?.room.status).toBe("archived");
    expect(s?.participation.currentForecasts).toBe(1);
    expect(s?.links.embedUrl).toBeNull();
    // unarchive
    expect((await roomPATCH(req(`/api/rooms/${room.slug}`, { method: "PATCH", body: { status: "active" }, cookie: cookieFor(a) }), ctx(room.slug))).status).toBe(200);
    expect((await roomGET(req(`/api/rooms/${room.slug}`), ctx(room.slug))).status).toBe(200);
    const again = (await (await roomsListGET(req("/api/rooms?limit=50"))).json()) as { rooms: { slug: string }[] };
    expect(again.rooms.map((r) => r.slug)).toContain(room.slug);
  });

  it("6. visibility changes keep the public directory consistent (Redis index synced)", async () => {
    const a = newWallet();
    const room = await seedRoom(m.repo, a);
    await m.repo.updateRoom(room.roomId, a, { visibility: "unlisted" }, NOW);
    expect((await m.repo.listPublicRooms({ limit: 50 })).map((r) => r.roomId)).not.toContain(room.roomId);
    if (m.fake) expect(m.fake.z.get(`${ROOMS_REDIS_PREFIX}public`)?.has(room.roomId) ?? false).toBe(false);
    await m.repo.updateRoom(room.roomId, a, { visibility: "public" }, NOW + 1);
    expect((await m.repo.listPublicRooms({ limit: 50 })).map((r) => r.roomId)).toContain(room.roomId);
    if (m.fake) expect(m.fake.z.get(`${ROOMS_REDIS_PREFIX}public`)?.has(room.roomId)).toBe(true);
    await m.repo.updateRoom(room.roomId, a, { status: "archived" }, NOW + 2);
    expect((await m.repo.listPublicRooms({ limit: 50 })).map((r) => r.roomId)).not.toContain(room.roomId);
    expect((await m.repo.listCreatorRoomsAll(a, { limit: 10 })).map((r) => r.status)).toEqual(["archived"]);
  });
});

// ---------------------------------------------------------------- 7–12 participation (SQLite ↔ Redis parity)

async function scenario(repo: RoomRepository) {
  const a = newWallet();
  const [w1, w2, w3] = [newWallet(), newWallet(), newWallet()];
  const r1 = await seedRoom(repo, a, { title: "R1" });
  const r2 = await seedRoom(repo, a, { title: "R2", marketId: MARKET2 });
  const r3 = await seedRoom(repo, a, { title: "R3 archived" });
  const other = await seedRoom(repo, newWallet(), { title: "Other creator" });
  await forecast(repo, r1, w1, 6000, NOW - 3 * DAY);
  await forecast(repo, r1, w1, 6500, NOW - 2 * DAY, 1); // revision: not "returning"
  await forecast(repo, r1, w1, 7000, NOW - 2 * DAY + 5, 2);
  await forecast(repo, r1, w2, 3000, NOW - 2 * DAY);
  await forecast(repo, r2, w1, 5000, NOW - 1 * DAY); // second room → returning
  await forecast(repo, r3, w3, 9000, NOW - 1 * DAY);
  await forecast(repo, other, w2, 4000, NOW); // other creator: not counted for a
  await repo.updateRoom(r3.roomId, a, { status: "archived" }, NOW);
  return { a, w1, w2, w3, r1, r2, r3 };
}

describe("participation stats: SQLite ↔ Redis parity", () => {
  it("7–9. unique, returning (≥ 2 distinct rooms, not edits), revisions per room and first-forecast times agree", async () => {
    const out: unknown[] = [];
    for (const f of factories) {
      const { repo } = f.make();
      const s = await scenario(repo);
      const rooms = await repo.listCreatorRoomsAll(s.a, { limit: 200 });
      const st = await repo.getCreatorStats(s.a, { rooms, sinceMs: NOW - 30 * DAY, maxFirst: 100 });
      expect(st.uniqueForecasters).toBe(3);
      expect(st.returningForecasters).toBe(1);
      expect(st.revisionsByRoom[s.r1.roomId]).toBe(4);
      expect(st.revisionsByRoom[s.r2.roomId]).toBe(1);
      expect(st.revisionsByRoom[s.r3.roomId]).toBe(1);
      expect(st.firstForecastTimes).toEqual([NOW - 3 * DAY, NOW - 2 * DAY, NOW - 1 * DAY]);
      out.push({ ...st, revisionsByRoom: Object.values(st.revisionsByRoom).sort() });
    }
    expect(out[0]).toEqual(out[1]);
  });

  it("10. overview: room counts, current vs revisions, pending, archived history and new-forecasters-by-day", async () => {
    const res: unknown[] = [];
    for (const f of factories) {
      const { repo } = f.make();
      const s = await scenario(repo);
      const o = await getStudioOverview(deps(repo), s.a);
      expect(o.rooms).toMatchObject({ total: 3, active: 2, archived: 1, public: 3, unlisted: 0, truncated: false });
      expect(o.participation).toMatchObject({ uniqueForecasters: 3, returningForecasters: 1, currentForecasts: 4, revisions: 6, pendingForecasts: 4, scoredForecasts: 0, challenges: 0, approximate: false });
      const nb = Object.fromEntries(o.participation.newForecastersByDay.map((d) => [d.day, d.count]));
      expect(nb[utcDay(NOW - 3 * DAY)]).toBe(1);
      expect(nb[utcDay(NOW - 2 * DAY)]).toBe(1);
      expect(nb[utcDay(NOW - 1 * DAY)]).toBe(1);
      expect(o.participation.newForecastersByDay).toHaveLength(30);
      res.push(o.participation);
    }
    expect(res[0]).toEqual(res[1]);
  });

  it("10b. scored / blocked finalizations move forecasts out of pending (counts from score records, not guesses)", async () => {
    const { repo } = factories[0].make();
    const s = await scenario(repo);
    const fin = (marketId: string) =>
      marketId === MARKET2 ? { marketId, status: "blocked" } : marketId === MARKET ? { marketId, status: "scored" } : null;
    const proxied = new Proxy(repo, {
      get(t, p, rcv) {
        if (p === "getFinalization") return async (id: string) => fin(id);
        if (p === "listRoomScores") return async (roomId: string) => ({ items: [], total: roomId === s.r1.roomId ? 2 : roomId === s.r3.roomId ? 1 : 0 });
        return Reflect.get(t, p, rcv);
      },
    }) as RoomRepository;
    const o = await getStudioOverview(deps(proxied), s.a);
    expect(o.participation).toMatchObject({ scoredForecasts: 3, pendingForecasts: 0, unscoredBlocked: 1, finalizedRooms: 3 });
    const one = await getStudioRoom(deps(proxied), s.a, s.r1.slug);
    expect(one?.participation).toMatchObject({ scored: 2, pending: 0 });
    expect(one?.room.forecasting).toBe("closed");
  });

  it("11. Redis: the one-time backfill rebuilds indexes from pre-existing forecasts, is idempotent, then notes keep it current", async () => {
    const sqlite = factories[0].make().repo;
    const r = new FakeRedis();
    const redis = new RedisRoomRepository(r);
    const results: unknown[] = [];
    for (const repo of [sqlite, redis]) {
      const a = "CreatorWa11etForBackfi11Test1111111111111111";
      const w1 = "Wa11etOne11111111111111111111111111111111111";
      const w2 = "Wa11etTwo11111111111111111111111111111111111";
      const r1 = await seedRoom(repo, a, { slug: `bf-one-${repo.kind}` });
      const r2 = await seedRoom(repo, a, { slug: `bf-two-${repo.kind}` });
      await rawForecast(repo, r1, w1, 6000, NOW - 4 * DAY);
      await rawForecast(repo, r1, w1, 6100, NOW - 3 * DAY, 1);
      await rawForecast(repo, r2, w1, 5000, NOW - 2 * DAY);
      await rawForecast(repo, r2, w2, 2000, NOW - 2 * DAY);
      const rooms = await repo.listCreatorRoomsAll(a, { limit: 200 });
      const first = await repo.getCreatorStats(a, { rooms, sinceMs: 0, maxFirst: 100 });
      const second = await repo.getCreatorStats(a, { rooms, sinceMs: 0, maxFirst: 100 });
      expect(second).toEqual(first);
      // a new revision after the backfill is counted once
      await forecast(repo, r2, w2, 2500, NOW - DAY, 1);
      const third = await repo.getCreatorStats(a, { rooms, sinceMs: 0, maxFirst: 100 });
      expect(third.revisionsByRoom[r2.roomId]).toBe(3);
      results.push({ first: { ...first, revisionsByRoom: Object.values(first.revisionsByRoom).sort() }, third: { ...third, revisionsByRoom: Object.values(third.revisionsByRoom).sort() } });
    }
    expect(results[0]).toEqual(results[1]);
    expect(r.kv.get(studioKeys(ROOMS_REDIS_PREFIX, "CreatorWa11etForBackfi11Test1111111111111111").v)?.v).toBe("1");
  });

  it("12. a failed Studio index update never fails a saved forecast", async () => {
    const r = new FakeRedis();
    const repo = new RedisRoomRepository(r);
    const a = newWallet();
    const room = await seedRoom(repo, a);
    const failing = new Proxy(repo, {
      get(t, p, rcv) {
        if (p === "noteCreatorActivity") return async () => {
          throw new Error("index down");
        };
        return Reflect.get(t, p, rcv);
      },
    }) as RoomRepository;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await forecast(failing, room, newWallet(), 4200, NOW);
    expect(res.status).toBe("created");
    expect(warn).toHaveBeenCalledWith("[studio] creator index update failed");
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------- 13–22 distribution events

describe.each(factories)("distribution events: $name", ({ make }) => {
  let m: Made;
  let a: string;
  let room: RoomRecord;
  beforeEach(async () => {
    m = make();
    __setRoomRepositoryForTests(m.repo);
    __resetSnapshotCacheForTests();
    a = newWallet();
    room = await seedRoom(m.repo, a);
  });
  afterEach(() => __setRoomRepositoryForTests(undefined));

  it("13. a valid beacon counts one daily-deduplicated view; the same browser again counts nothing", async () => {
    const ip = "203.0.113.7";
    expect((await beacon(room.slug, {}, { ip })).status).toBe(204);
    expect((await beacon(room.slug, {}, { ip })).status).toBe(204);
    expect((await beacon(room.slug, {}, { ip, ua: `${UA} Edg/129.0` })).status).toBe(204); // different browser
    const rows = await counters(m.repo, a);
    expect(count(rows, room.roomId, METRIC.view)).toBe(2);
    expect(count(rows, room.roomId, METRIC.srcDirect)).toBe(2);
  });

  it("14. event injection is rejected: unknown fields, wrong schema, bad campaign, oversize, cross-origin", async () => {
    expect((await beacon(room.slug, { wallet: a })).status).toBe(400);
    expect((await beacon(room.slug, { schemaVersion: 2 })).status).toBe(400);
    expect((await beacon(room.slug, { event: "forecast" })).status).toBe(400);
    expect((await beacon(room.slug, { campaign: "Bad_ID!" })).status).toBe(400);
    expect((await beacon(room.slug, { ref: "https://evil.example" })).status).toBe(400);
    expect((await beacon(room.slug, { referrerHost: "x".repeat(300) })).status).toBe(400);
    expect((await eventsPOST(req(`/api/rooms/${room.slug}/events`, { method: "POST", rawBody: "x".repeat(2000) }), ctx(room.slug))).status).toBe(413);
    expect((await beacon(room.slug, {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await beacon(room.slug, {}, { origin: null })).status).toBe(403);
    expect(await counters(m.repo, a)).toEqual([]);
  });

  it("15. bots, prefetches and Do Not Track / GPC are answered 204 but never counted", async () => {
    for (const init of [
      { ua: null },
      { ua: "curl/8.4.0" },
      { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      { ua: `${UA} HeadlessChrome/129.0` },
      { headers: { "sec-purpose": "prefetch" } },
      { headers: { purpose: "prefetch" } },
      { headers: { "next-router-prefetch": "1" } },
      { headers: { dnt: "1" } },
      { headers: { "sec-gpc": "1" } },
    ] as Parameters<typeof req>[1][]) {
      expect((await beacon(room.slug, {}, init)).status).toBe(204);
    }
    expect(await counters(m.repo, a)).toEqual([]);
  });

  it("16. referrers become buckets (never URLs); ?ref=embed and campaigns are attributed", async () => {
    await beacon(room.slug, { referrerHost: "news.example.com" });
    await beacon(room.slug, { referrerHost: "https://news.example.com/path?q=secret" });
    await beacon(room.slug, { referrerHost: "localhost" });
    await beacon(room.slug, { ref: "embed", campaign: "newsletter-oct" });
    await beacon(room.slug, { campaign: "newsletter-oct" });
    const rows = await counters(m.repo, a);
    expect(count(rows, room.roomId, "src:h:news.example.com")).toBe(1);
    expect(count(rows, room.roomId, METRIC.srcOther)).toBe(1); // the URL was refused as a host
    expect(count(rows, room.roomId, METRIC.srcSameSite)).toBe(1);
    expect(count(rows, room.roomId, METRIC.srcEmbed)).toBe(1);
    expect(count(rows, room.roomId, METRIC.cta)).toBe(1);
    expect(count(rows, room.roomId, "c:newsletter-oct")).toBe(2);
    expect(JSON.stringify(rows)).not.toMatch(/secret|path|https?:/);
  });

  it("17. no raw IP or user agent is stored anywhere", async () => {
    const ip = "198.51.100.42";
    await beacon(room.slug, {}, { ip, ua: `${UA} UniqueMarker/123` });
    await embedGET(req(`/embed/rooms/${room.slug}`, { ip, ua: `${UA} UniqueMarker/123` }), ctx(room.slug));
    await vi.waitFor(async () => expect(count(await counters(m.repo, a), room.roomId, METRIC.embed)).toBe(1));
    const dump = m.file ? readFileSync(m.file).toString("latin1") : JSON.stringify({ kv: [...m.fake!.kv], h: [...m.fake!.h].map(([k, v]) => [k, [...v]]) });
    expect(dump).not.toContain(ip);
    expect(dump).not.toContain("UniqueMarker");
  });

  it("18. archived, missing and malformed rooms are never counted", async () => {
    await m.repo.updateRoom(room.roomId, a, { status: "archived" }, NOW);
    expect((await beacon(room.slug)).status).toBe(204);
    expect((await beacon("no-such-room")).status).toBe(204);
    expect((await beacon("Bad Slug!")).status).toBe(204);
    expect((await embedGET(req(`/embed/rooms/${room.slug}`), ctx(room.slug))).status).toBe(404);
    await new Promise((r) => setTimeout(r, 30));
    expect(await counters(m.repo, a)).toEqual([]);
  });

  it("19. embed requests are counted server-side (approximate); same-origin previews and bots aren't; the widget gains no script", async () => {
    const res = await embedGET(req(`/embed/rooms/${room.slug}`, { headers: { "sec-fetch-site": "cross-site" } }), ctx(room.slug));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toMatch(/<script|sendBeacon|fetch\(/i);
    expect(html).toContain(`/rooms/${room.slug}?ref=embed`);
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    await embedGET(req(`/embed/rooms/${room.slug}`, { headers: { "sec-fetch-site": "same-origin" } }), ctx(room.slug));
    await embedGET(req(`/embed/rooms/${room.slug}`, { ua: "curl/8.4.0" }), ctx(room.slug));
    await vi.waitFor(async () => expect(count(await counters(m.repo, a), room.roomId, METRIC.embed)).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(count(await counters(m.repo, a), room.roomId, METRIC.embed)).toBe(1);
  });

  it("20. dynamic fields (referrer hosts, campaigns) are capped per room per day and fold into 'other'", async () => {
    const day = utcDay(NOW);
    for (let i = 0; i < MAX_DYNAMIC_FIELDS_PER_ROOM_DAY + 5; i++) {
      await m.repo.recordStudioEvent({ creatorWallet: a, roomId: room.roomId, day, metrics: [METRIC.view, `src:h:site${i}.example`], dedupeKey: `cap-${i}`, nowMs: NOW });
    }
    await m.repo.recordStudioEvent({ creatorWallet: a, roomId: room.roomId, day, metrics: ["c:late-campaign"], dedupeKey: "cap-c", nowMs: NOW });
    const rows = await m.repo.listStudioCounters(a, { days: [day] });
    const dyn = rows.filter((r) => r.metric.startsWith("src:h:") || (r.metric.startsWith("c:") && r.metric !== METRIC.campaignOther));
    expect(dyn).toHaveLength(MAX_DYNAMIC_FIELDS_PER_ROOM_DAY);
    expect(count(rows, room.roomId, METRIC.srcOther)).toBe(5);
    expect(count(rows, room.roomId, METRIC.campaignOther)).toBe(1);
    expect(count(rows, room.roomId, METRIC.view)).toBe(MAX_DYNAMIC_FIELDS_PER_ROOM_DAY + 5);
    // a repeated dedupe key changes nothing
    expect(await m.repo.recordStudioEvent({ creatorWallet: a, roomId: room.roomId, day, metrics: [METRIC.view], dedupeKey: "cap-0", nowMs: NOW })).toBe("duplicate");
    expect(count(await m.repo.listStudioCounters(a, { days: [day] }), room.roomId, METRIC.view)).toBe(MAX_DYNAMIC_FIELDS_PER_ROOM_DAY + 5);
  });

  it("21. retention: counters older than the retention window are pruned / expire", async () => {
    const old = NOW - (ANALYTICS_RETENTION_DAYS + 2) * DAY;
    await m.repo.recordStudioEvent({ creatorWallet: a, roomId: room.roomId, day: utcDay(old), metrics: [METRIC.view], dedupeKey: "old-1", nowMs: old });
    await m.repo.recordStudioEvent({ creatorWallet: a, roomId: room.roomId, day: utcDay(NOW), metrics: [METRIC.view], dedupeKey: "new-1", nowMs: NOW });
    if (m.fake) {
      const k = studioKeys(ROOMS_REDIS_PREFIX, a).day(utcDay(NOW));
      const ttl = (m.fake.exp.get(k) ?? 0) - Date.now();
      expect(ttl).toBeGreaterThan(ANALYTICS_RETENTION_DAYS * DAY);
      expect(ttl).toBeLessThanOrEqual((ANALYTICS_RETENTION_DAYS + 1) * DAY);
    } else {
      expect(await m.repo.listStudioCounters(a, { days: [utcDay(old)] })).toEqual([]);
    }
    expect(count(await m.repo.listStudioCounters(a, { days: [utcDay(NOW)] }), room.roomId, METRIC.view)).toBe(1);
  });

  it("22. public room and embed responses never expose creator metrics", async () => {
    await beacon(room.slug);
    const pub = (await (await roomGET(req(`/api/rooms/${room.slug}`), ctx(room.slug))).json()) as { room: Record<string, unknown> };
    expect(Object.keys(pub.room).sort()).toEqual(["createdAt", "creatorWallet", "description", "marketId", "roomId", "schemaVersion", "slug", "status", "title", "updatedAt", "visibility"]);
    const html = await (await embedGET(req(`/embed/rooms/${room.slug}`), ctx(room.slug))).text();
    expect(html).not.toMatch(/views|embed requests|click-through|campaign/i);
  });
});

describe("distribution parity", () => {
  it("23. the same event stream yields identical counters on SQLite and Redis", async () => {
    const out: unknown[] = [];
    for (const f of factories) {
      const { repo } = f.make();
      const a = "CreatorWa11etForParityTest111111111111111111";
      const day = utcDay(NOW);
      const events: [string, string[]][] = [
        ["k1", [METRIC.view, METRIC.srcDirect]],
        ["k2", [METRIC.view, "src:h:a.example", "c:spring"]],
        ["k2", [METRIC.view]],
        ["k3", [METRIC.embed]],
        ["k4", [METRIC.view, METRIC.srcEmbed, METRIC.cta]],
      ];
      const results = [];
      for (const [k, metrics] of events) results.push(await repo.recordStudioEvent({ creatorWallet: a, roomId: "room_aaaaaaaaaaaaaaaaaaaaaaaa", day, metrics, dedupeKey: k, nowMs: NOW }));
      out.push({ results, rows: await repo.listStudioCounters(a, { days: recentDays(NOW, 3) }) });
    }
    expect(out[0]).toEqual(out[1]);
    expect((out[0] as { results: string[] }).results).toEqual(["counted", "counted", "duplicate", "counted", "counted"]);
  });
});

// ---------------------------------------------------------------- 24–28 pure logic, list, insights

describe("studio logic", () => {
  it("24. request classification, host cleaning, source buckets and the daily-rotating HMAC key", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(skipReason(h({ "user-agent": UA }))).toBeNull();
    expect(skipReason(h({}))).toBe("bot");
    expect(skipReason(h({ "user-agent": "python-requests/2.31" }))).toBe("bot");
    expect(skipReason(h({ "user-agent": UA, "sec-purpose": "prefetch;prerender" }))).toBe("prefetch");
    expect(skipReason(h({ "user-agent": UA, dnt: "1" }))).toBe("privacy");
    expect(cleanHost("News.Example.COM.")).toBe("news.example.com");
    expect(cleanHost("https://a.example/x")).toBeNull();
    expect(cleanHost("a.example:8080")).toBeNull();
    expect(cleanHost("<script>.example")).toBeNull();
    expect(sourceMetric({ referrerHost: null }, ["localhost"])).toBe(METRIC.srcDirect);
    expect(sourceMetric({ ref: "embed", referrerHost: "x.example" }, [])).toBe(METRIC.srcEmbed);
    expect(sourceMetric({ referrerHost: "briefcommand.vercel.app" }, ["briefcommand.vercel.app"])).toBe(METRIC.srcSameSite);
    const base = { secret: "s".repeat(40), nowMs: NOW, ip: "1.2.3.4", ua: UA, roomId: "room_x", event: "room_view" };
    const k = dedupeKey(base)!;
    expect(k).toMatch(/^[a-f0-9]{40}$/);
    expect(dedupeKey(base)).toBe(k);
    expect(dedupeKey({ ...base, nowMs: NOW + DAY })).not.toBe(k);
    expect(dedupeKey({ ...base, roomId: "room_y" })).not.toBe(k);
    expect(dedupeKey({ ...base, event: "embed" })).not.toBe(k);
    expect(dedupeKey({ ...base, secret: null })).toBeNull();
    expect(k).not.toContain("1.2.3.4");
  });

  it("25. rooms list: search, status filter, pagination and parameter validation", async () => {
    const { repo } = factories[1].make();
    __setRoomRepositoryForTests(repo);
    const a = newWallet();
    for (let i = 0; i < 12; i++) await seedRoom(repo, a, { title: i % 3 === 0 ? `Haaland ${i}` : `Salah ${i}`, status: i === 4 ? "archived" : "active", visibility: i === 5 ? "unlisted" : "public" });
    const p1 = await listStudioRooms(deps(repo), a, { q: "", status: "all", page: 1 });
    expect(p1).toMatchObject({ total: 12, pages: 2, page: 1 });
    expect(p1.items).toHaveLength(10);
    expect((await listStudioRooms(deps(repo), a, { q: "", status: "all", page: 9 })).page).toBe(2);
    expect((await listStudioRooms(deps(repo), a, { q: "haaland", status: "all", page: 1 })).total).toBe(4);
    expect((await listStudioRooms(deps(repo), a, { q: "", status: "archived", page: 1 })).items.map((r) => r.forecasting)).toEqual(["archived"]);
    expect((await listStudioRooms(deps(repo), a, { q: "", status: "unlisted", page: 1 })).total).toBe(1);
    const row = p1.items[0];
    expect(row).toMatchObject({ lifecycle: null, lifecycleLabel: "Market status unavailable", forecasting: "unknown", participants: 0, communityMeanBps: null });
    const cookie = cookieFor(a);
    expect((await roomsGET(req("/api/studio/rooms?status=deleted", { cookie }))).status).toBe(400);
    expect((await roomsGET(req("/api/studio/rooms?page=-1", { cookie }))).status).toBe(400);
    expect((await roomsGET(req("/api/studio/rooms?page=1&q=salah&status=active", { cookie }))).status).toBe(200);
    __setRoomRepositoryForTests(undefined);
  });

  it("26. untracked distribution is 'Not tracked yet', never 0; summaries filter by room and window", () => {
    const days = recentDays(NOW, 30);
    const none = summarizeDistribution([], days);
    expect(none.tracked).toBe(false);
    if (!none.tracked) expect(none.reason).toContain(NOT_TRACKED);
    const rows = [
      { day: days[29], roomId: "r1", metric: METRIC.view, count: 3 },
      { day: days[29], roomId: "r2", metric: METRIC.view, count: 5 },
      { day: days[28], roomId: "r1", metric: METRIC.embed, count: 2 },
      { day: days[28], roomId: "r1", metric: "c:spring", count: 1 },
      { day: "2020-01-01", roomId: "r1", metric: METRIC.view, count: 99 },
    ];
    const all = summarizeDistribution(rows, days);
    expect(all.tracked && all.value).toMatchObject({ views: 8, embedRequests: 2, since: days[28], campaigns: [{ id: "spring", count: 1 }] });
    const r1 = summarizeDistribution(rows, days, "r1");
    expect(r1.tracked && r1.value.views).toBe(3);
    expect(summarizeDistribution(rows, days, "r3").tracked).toBe(false);
  });

  it("27. insights are deterministic, from measured numbers only, and never claim conversions", () => {
    const base: InsightInput = {
      rooms: { total: 3, active: 2, archived: 1 },
      uniqueForecasters: 8,
      returningForecasters: 3,
      currentForecasts: 10,
      revisions: 20,
      pendingForecasts: 10,
      scoredForecasts: 0,
      activeRoomsWithoutForecasts: 1,
      topRoom: { title: "R1", currentForecasts: 6 },
      distribution: { tracked: true, value: { since: "2026-10-01", views: 40, embedRequests: 12, ctaClicks: 0, sources: [{ key: "src:h:news.example", label: "news.example", count: 9 }], campaigns: [], byDay: [] } },
    };
    const a = buildInsights(base);
    expect(buildInsights(base)).toEqual(a);
    expect(a.map((i) => i.id)).toEqual(["empty-rooms", "top-room", "returning", "revisions", "pending", "embed-no-clicks", "top-referrer"]);
    for (const i of a) expect(i.basis.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).not.toMatch(/conversion|converted|people visited|users/i);
    expect(buildInsights({ ...base, uniqueForecasters: 1 }).map((i) => i.id)).toContain("sparse");
    expect(buildInsights({ ...base, distribution: { tracked: false, reason: "x" } }).map((i) => i.id)).toContain("distribution-new");
    expect(buildInsights({ ...base, rooms: { total: 0, active: 0, archived: 0 } }).map((i) => i.id)).toEqual(["no-rooms"]);
  });

  it("28. campaign links are validated ids on the canonical room URL (no redirects, no arbitrary params)", () => {
    expect(campaignUrl("https://briefcommand.vercel.app/rooms/x", "newsletter-oct")).toBe("https://briefcommand.vercel.app/rooms/x?c=newsletter-oct");
    for (const bad of ["", "UPPER", "a".repeat(33), "a_b", "a b", "x&next=https://evil.example", "../x"]) {
      expect(campaignUrl("https://briefcommand.vercel.app/rooms/x", bad)).toBeNull();
    }
  });
});
