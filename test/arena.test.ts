/**
 * Phase 3 — Forecasting Arena: scoring, verified finalization, immutable
 * score records, global de-duplication, reputation/ranking, read models and
 * the HTTP routes. Every repository test runs on BOTH adapters: the SQLite
 * file store and the Redis adapter whose Lua scripts execute in a real Lua VM
 * (fengari) over an in-memory keyspace. Wallet keys are generated per run.
 * Resolution evidence is injected (never live Panta / RPC here). No live
 * Upstash is exercised.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { NextRequest } from "next/server";
import initSqlJs from "sql.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Market } from "@/lib/panta/domain";
import { decodeEventAccount } from "@/lib/panta/chain-events";
import type { ChainEventRead } from "@/lib/panta/chain-event-server";
import {
  BRIER_E8_MAX,
  adjustedScoreC,
  brierE8,
  computeMarketScores,
  displayScoreC,
  finalEligibleRevision,
  formatBrierE8,
  formatScoreC,
  rankKey,
  reputationView,
  roundHalfUpDiv,
  type MarketForecastSnapshot,
  type ReputationRecord,
} from "@/lib/arena/scoring";
import { decideResolution, type DetailEvidenceRead } from "@/lib/arena/evidence";
import type { ResolutionEvidence } from "@/lib/arena/evidence-server";
import { finalizeMarket, finalizePending, type FinalizeDeps } from "@/lib/arena/finalize";
import { checkAdminToken } from "@/lib/arena/admin";
import { arenaPage, forecasterProfile, roomLeaderboard, IN_PROGRESS_TEXT } from "@/lib/arena/service";
import { FinalizationIntegrityError } from "@/lib/arena/types";
import { __setArenaDepsForTests } from "@/lib/arena/deps";
import { newRoomId } from "@/lib/rooms/service";
import { SqliteRoomRepository } from "@/lib/rooms/store/sqlite";
import { RedisRoomRepository } from "@/lib/rooms/store/redis";
import { __setRoomRepositoryForTests } from "@/lib/rooms/store";
import type { RoomRepository } from "@/lib/rooms/store/types";
import type { RoomRecord } from "@/lib/rooms/domain";
import { eventAccountBytes } from "./helpers/event-account";
import { FakeRedis } from "./helpers/fake-redis";
import { isolatedRedisBackends } from "./helpers/isolated-redis";

// ---------------------------------------------------------------- fixtures

const MARKET = "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn";
const MARKET_2 = "8xwFfRzQ4tJRF7Cz7fjxjHVx4mJkqvqHkZAC4vGgxFs6";
const PPE_SEC = 1_800_000_000; // forecasting cutoff (primary phase end)
const CUTOFF = PPE_SEC * 1000;
const T0 = CUTOFF - 10 * 86_400_000;
const AFTER = CUTOFF + 2 * 86_400_000; // finalization clock

function newWallet(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  return bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url"));
}

let tmpDirs: string[] = [];
function tmpDbFile(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "arena-test-"));
  tmpDirs.push(d);
  return path.join(d, "rooms.sqlite");
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

type Adapter = { repo: RoomRepository; file?: string; fake?: FakeRedis };
const adapters: [string, () => Adapter][] = [
  [
    "sqlite",
    () => {
      const file = tmpDbFile();
      return { repo: new SqliteRoomRepository(file), file };
    },
  ],
  [
    "redis (Lua in VM)",
    () => {
      const fake = new FakeRedis();
      return { repo: new RedisRoomRepository(fake), fake };
    },
  ],
  ...isolatedRedisBackends().map((b): (typeof adapters)[number] => [b.name, () => ({ repo: b.open().repo })]),
];

let seq = 0;
async function seedRoom(repo: RoomRepository, marketId = MARKET, over: Partial<RoomRecord> = {}): Promise<RoomRecord> {
  const roomId = over.roomId ?? newRoomId();
  const room: RoomRecord = {
    roomId,
    slug: `arena-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: `Room ${seq}`,
    description: "",
    creatorWallet: newWallet(),
    marketId,
    visibility: "public",
    status: "active",
    createdAt: T0,
    updatedAt: T0,
    ...over,
  } as RoomRecord;
  await repo.createRoom(
    { roomId: room.roomId, slug: room.slug, title: room.title, description: "", creatorWallet: room.creatorWallet, marketId, visibility: room.visibility, createdAt: T0 },
    { key: `room-key-${room.roomId}`.slice(0, 40), fingerprint: "room" },
  );
  return (await repo.getRoomById(room.roomId))!;
}

/** Same order as the forecast service: index participation, then write the revision. */
async function forecast(repo: RoomRepository, room: RoomRecord, wallet: string, bps: number, at: number) {
  const cur = await repo.getCurrentForecast(room.roomId, wallet);
  await repo.noteParticipation({ wallet, roomId: room.roomId, marketId: room.marketId, at });
  return repo.submitForecast(
    { roomId: room.roomId, wallet, probabilityBps: bps, reasoning: "", expectedRevision: cur?.revision ?? 0, now: at, newForecastId: `fc_${String(++seq).padStart(24, "0")}` },
    { key: `idem-${String(++seq).padStart(14, "0")}`, fingerprint: `fp-${seq}` },
  );
}

const detail = (over: Partial<Market> = {}): Market => ({
  marketId: MARKET,
  title: "Haaland 8+ points, GW6",
  category: "sports",
  phase: "resolved",
  status: "resolved",
  endTime: PPE_SEC + 3600,
  primaryPhaseEndTime: PPE_SEC,
  yesPrice: "1",
  noPrice: "0",
  resolved: true,
  outcome: "yes",
  ...over,
});

const chain = (o: { resolved?: boolean; yesWins?: boolean; cancelled?: boolean } = {}, slot = 455_123_456): ChainEventRead => ({
  status: "ok",
  event: decodeEventAccount(
    MARKET,
    eventAccountBytes({ nowSec: PPE_SEC - 86_400, start: PPE_SEC - 20 * 86_400, primaryPhaseEnd: PPE_SEC, end: PPE_SEC + 3600, resolvedAt: o.resolved === false ? 0 : PPE_SEC + 7200, resolved: o.resolved ?? true, yesWins: o.yesWins ?? true, cancelled: o.cancelled }),
  )!,
  slot,
  fetchedAt: AFTER,
});

const okDetail = (over: Partial<Market> = {}): DetailEvidenceRead => ({ status: "ok", detail: detail(over), fetchedAt: AFTER });

function evidenceDeps(repo: RoomRepository, ev: () => ResolutionEvidence, calls = { n: 0 }): FinalizeDeps {
  return {
    repo,
    gatherEvidence: async () => {
      calls.n += 1;
      return ev();
    },
    now: () => AFTER,
  };
}
const resolvedYes = (): ResolutionEvidence => ({ detail: okDetail(), chain: chain() });
const resolvedNo = (): ResolutionEvidence => ({ detail: okDetail({ outcome: "no" }), chain: chain({ yesWins: false }) });

// ---------------------------------------------------------------- pure scoring

describe("arena scoring math (pure)", () => {
  it("1. Brier in integer fixed point: 80% YES → 96.00, NO → 36.00; diff² in 1e-8 units", () => {
    expect(brierE8(8000, "yes")).toBe(4_000_000);
    expect(displayScoreC(brierE8(8000, "yes"))).toBe(9600);
    expect(brierE8(8000, "no")).toBe(64_000_000);
    expect(displayScoreC(brierE8(8000, "no"))).toBe(3600);
    expect(formatScoreC(9600)).toBe("96.00");
    expect(formatBrierE8(4_000_000)).toBe("0.0400");
  });

  it("2. boundaries 0% / 50% / 100% and invalid input", () => {
    expect([brierE8(10_000, "yes"), brierE8(0, "no")]).toEqual([0, 0]);
    expect(displayScoreC(0)).toBe(10_000);
    expect(brierE8(0, "yes")).toBe(BRIER_E8_MAX);
    expect(displayScoreC(BRIER_E8_MAX)).toBe(0);
    expect(displayScoreC(brierE8(5000, "yes"))).toBe(7500);
    expect(displayScoreC(brierE8(5000, "no"))).toBe(7500);
    for (const bad of [-1, 10_001, 50.5, Number.NaN]) expect(() => brierE8(bad, "yes")).toThrow(RangeError);
    expect(() => brierE8(5000, "maybe" as never)).toThrow(RangeError);
    expect(() => displayScoreC(BRIER_E8_MAX + 1)).toThrow(RangeError);
  });

  it("3. display rounding is half-up on exact integers (no float drift)", () => {
    // 1 − 0.4333² = 0.81225111 → 81.225111 → 81.23 (round half-up of hundredths)
    expect(displayScoreC(brierE8(5667, "no") /* d = 5667 */)).toBe(roundHalfUpDiv(BRIER_E8_MAX - 5667 * 5667, 10_000));
    expect(roundHalfUpDiv(5, 10)).toBe(1);
    expect(roundHalfUpDiv(4, 10)).toBe(0);
    expect(roundHalfUpDiv(BigInt(15), BigInt(10))).toBe(2);
    // d = 50bps → brier 2500 → 99.9975 → 100.00 (half-up at .5 boundary)
    expect(displayScoreC(brierE8(9950, "yes"))).toBe(10_000);
    // d = 150 → 22500 → 99.9775 → 99.98
    expect(displayScoreC(brierE8(9850, "yes"))).toBe(9998);
    // every bps value: integer, monotone in |p − o|, within 0..10000
    let prev = Infinity;
    for (let p = 10_000; p >= 0; p -= 1) {
      const c = displayScoreC(brierE8(p, "yes"));
      expect(Number.isInteger(c) && c >= 0 && c <= 10_000 && c <= prev).toBe(true);
      prev = c;
    }
  });

  it("4. the final revision strictly BEFORE the cutoff is used (by timestamp, not revision count)", () => {
    const revs = [
      { revision: 1, probabilityBps: 3000, createdAt: CUTOFF - 3000 },
      { revision: 2, probabilityBps: 6000, createdAt: CUTOFF - 1 },
      { revision: 3, probabilityBps: 9000, createdAt: CUTOFF },
      { revision: 4, probabilityBps: 9900, createdAt: CUTOFF + 5 },
    ];
    expect(finalEligibleRevision(revs, CUTOFF)?.revision).toBe(2);
    expect(finalEligibleRevision(revs.slice(2), CUTOFF)).toBeNull();
    expect(finalEligibleRevision([], CUTOFF)).toBeNull();
  });

  it("5. no eligible forecast → no score; global = earliest first forecast, tie → roomId", () => {
    const w1 = newWallet();
    const w2 = newWallet();
    const snap: MarketForecastSnapshot = {
      marketId: MARKET,
      rooms: [
        { roomId: "room_bbbbbbbbbbbbbbbbbbbbbbbb", marketId: MARKET, forecasters: [
          { wallet: w1, forecastId: "fc_b1", revisions: [{ forecastId: "fc_b1", revision: 1, probabilityBps: 9000, createdAt: T0 + 10 }] },
          { wallet: w2, forecastId: "fc_b2", revisions: [{ forecastId: "fc_b2", revision: 1, probabilityBps: 9000, createdAt: CUTOFF + 1 }] },
        ] },
        { roomId: "room_aaaaaaaaaaaaaaaaaaaaaaaa", marketId: MARKET, forecasters: [
          { wallet: w1, forecastId: "fc_a1", revisions: [{ forecastId: "fc_a1", revision: 1, probabilityBps: 2000, createdAt: T0 + 20 }] },
        ] },
        { roomId: "room_cccccccccccccccccccccccc", marketId: MARKET_2, forecasters: [
          { wallet: w1, forecastId: "fc_c1", revisions: [{ forecastId: "fc_c1", revision: 1, probabilityBps: 2000, createdAt: T0 }] },
        ] },
      ],
    };
    const { roomScores, globalScores } = computeMarketScores(snap, "yes", CUTOFF, AFTER);
    expect(roomScores.map((s) => [s.roomId.slice(5, 6), s.wallet === w1])).toEqual([["a", true], ["b", true]]); // w2 unscored; foreign-market room ignored
    expect(globalScores).toHaveLength(1);
    expect(globalScores[0].roomId).toBe("room_bbbbbbbbbbbbbbbbbbbbbbbb"); // earlier first forecast wins even with a worse id
    // tie on first forecast time → lower roomId
    snap.rooms[1].forecasters[0].revisions[0].createdAt = T0 + 10;
    expect(computeMarketScores(snap, "yes", CUTOFF, AFTER).globalScores[0].roomId).toBe("room_aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("6. reputation: adjusted (shrunk) score, provisional below 5, deterministic rank keys", () => {
    const rec = (wallet: string, n: number, brierEach: number, first = 1000): ReputationRecord => ({ wallet, scoredCount: n, sumBrierE8: n * brierEach, firstScoredAt: first, lastScoredAt: first + 1 });
    // one perfect market: (1e8 + 7500·5·1e4) / (6·1e4) = 79.1666… → 7917
    expect(adjustedScoreC(rec("a", 1, 0))).toBe(7917);
    expect(reputationView(rec("a", 4, 0)).ranked).toBe(false);
    expect(reputationView(rec("a", 5, 0)).ranked).toBe(true);
    // a perfect 1-market streak ranks below a strong 20-market record
    expect(rankKey(rec("z", 20, 1_000_000)) < rankKey(rec("a", 1, 0))).toBe(true);
    // ties: same adjusted → more markets first → lower mean Brier → earlier first score → wallet
    const a = rec("Awallet", 10, 4_000_000, 5000);
    const b = rec("Bwallet", 10, 4_000_000, 5000);
    const c = rec("Cwallet", 10, 4_000_000, 4000);
    expect([b, a, c].map(rankKey).sort()).toEqual([c, a, b].map(rankKey));
    expect(reputationView(a).avgDisplayC).toBe(9600);
  });
});

// ---------------------------------------------------------------- evidence decision

describe("resolution evidence decision (pure)", () => {
  it("7. both sources final + same side → resolved; cutoff = earliest of ppe/end; provenance has slot and fetch times", () => {
    const d = decideResolution(MARKET, okDetail(), chain(), AFTER);
    expect(d.kind).toBe("resolved");
    if (d.kind !== "resolved") return;
    expect(d.outcome).toBe("yes");
    expect(d.cutoffAt).toBe(CUTOFF);
    expect(d.provenance.chain).toMatchObject({ source: "solana_event_account", account: MARKET, status: "ok", slot: 455_123_456, isResolved: true, outcome: "yes" });
    expect(d.provenance.panta).toMatchObject({ source: "panta_market_record", status: "ok", resolved: true, outcome: "yes", endpoint: `GET /markets/${MARKET}/` });
    expect(d.provenance.panta.fetchedAt).toBe(new Date(AFTER).toISOString());
  });

  it("8. never inferred: unresolved, one-sided, partial, unreadable, cancelled, conflicting, no cutoff", () => {
    const k = (det: DetailEvidenceRead, ch: ChainEventRead) => decideResolution(MARKET, det, ch, AFTER).kind;
    expect(k(okDetail({ resolved: false, outcome: undefined, phase: "secondary", status: "secondary" }), chain({ resolved: false }))).toBe("not_resolved");
    // price at 100% is not resolution
    expect(k(okDetail({ resolved: false, outcome: undefined, yesPrice: "1" }), chain({ resolved: false }))).toBe("not_resolved");
    expect(k(okDetail(), chain({ resolved: false }))).toBe("missing_evidence");
    expect(k(okDetail({ resolved: false, outcome: undefined }), chain())).toBe("missing_evidence");
    expect(k(okDetail({ outcome: undefined }), chain())).toBe("missing_evidence");
    expect(k({ status: "ok", detail: { marketId: MARKET, partial: true } as Market, fetchedAt: AFTER }, chain())).toBe("missing_evidence");
    expect(k({ status: "failed", detail: null, fetchedAt: AFTER }, chain())).toBe("missing_evidence");
    expect(k(okDetail(), { status: "failed", error: "timeout", fetchedAt: AFTER })).toBe("missing_evidence");
    expect(k(okDetail(), { status: "not_found", slot: 1, fetchedAt: AFTER })).toBe("missing_evidence");
    expect(k(okDetail(), chain({ cancelled: true }))).toBe("cancelled");
    expect(k(okDetail({ outcome: "no" }), chain({ yesWins: true }))).toBe("blocked");
    expect(k(okDetail({ primaryPhaseEndTime: undefined }), { ...chain(), event: { ...(chain() as { event: NonNullable<ReturnType<typeof decodeEventAccount>> }).event, primaryPhaseEndTime: 0 } } as ChainEventRead)).toBe(
      "missing_evidence",
    );
  });
});

// ---------------------------------------------------------------- admin token

describe("admin token", () => {
  const TOKEN = "t".repeat(40);
  it("9. fails closed when unset/short; constant-time compare; Bearer only", () => {
    expect(checkAdminToken(`Bearer ${TOKEN}`, {})).toMatchObject({ ok: false, status: 503 });
    expect(checkAdminToken("Bearer short", { ROOMS_ADMIN_TOKEN: "short" })).toMatchObject({ ok: false, status: 503 });
    expect(checkAdminToken(null, { ROOMS_ADMIN_TOKEN: TOKEN })).toMatchObject({ ok: false, status: 401 });
    expect(checkAdminToken(TOKEN, { ROOMS_ADMIN_TOKEN: TOKEN })).toMatchObject({ ok: false, status: 401 });
    expect(checkAdminToken(`Bearer ${TOKEN}x`, { ROOMS_ADMIN_TOKEN: TOKEN })).toMatchObject({ ok: false, status: 401 });
    expect(checkAdminToken(`Bearer ${TOKEN.slice(1)}`, { ROOMS_ADMIN_TOKEN: TOKEN })).toMatchObject({ ok: false, status: 401 });
    expect(checkAdminToken(`Bearer ${TOKEN}`, { ROOMS_ADMIN_TOKEN: TOKEN })).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------- repository + finalization (both adapters)

describe.each(adapters)("arena finalization: %s", (_name, make) => {
  it("10. not resolved / missing evidence / cancelled → nothing written, still pending", async () => {
    const { repo } = make();
    const room = await seedRoom(repo);
    const w = newWallet();
    await forecast(repo, room, w, 7000, T0);
    for (const ev of [
      (): ResolutionEvidence => ({ detail: okDetail({ resolved: false, outcome: undefined }), chain: chain({ resolved: false }) }),
      (): ResolutionEvidence => ({ detail: { status: "failed", detail: null, fetchedAt: AFTER }, chain: chain() }),
      (): ResolutionEvidence => ({ detail: okDetail(), chain: chain({ resolved: false }) }),
      (): ResolutionEvidence => ({ detail: okDetail(), chain: chain({ cancelled: true }) }),
    ]) {
      const r = await finalizeMarket(evidenceDeps(repo, ev), MARKET);
      expect(["not_resolved", "missing_evidence", "cancelled"]).toContain(r.result);
    }
    expect(await repo.getFinalization(MARKET)).toBeNull();
    expect(await repo.getRoomScore(room.roomId, w)).toBeNull();
    expect(await repo.getReputation(w)).toBeNull();
    expect((await repo.countPendingMarkets([w]))[w]).toBe(1);
    expect(await repo.listUnfinalizedMarkets({ limit: 10 })).toEqual([MARKET]);
  });

  it("11. verified resolution → immutable room scores from the final pre-cutoff revision, with provenance", async () => {
    const { repo } = make();
    const room = await seedRoom(repo);
    const [a, b, late] = [newWallet(), newWallet(), newWallet()];
    await forecast(repo, room, a, 3000, T0);
    await forecast(repo, room, a, 8000, CUTOFF - 60_000); // final pre-cutoff
    await forecast(repo, room, a, 100, CUTOFF + 1); // after cutoff: ignored (and impossible via the service)
    await forecast(repo, room, b, 4000, T0 + 5);
    await forecast(repo, room, late, 9900, CUTOFF); // exactly at cutoff → not eligible
    const r = await finalizeMarket(evidenceDeps(repo, resolvedYes), MARKET);
    expect(r).toMatchObject({ result: "scored", scoresWritten: 2, globalScoresWritten: 2, roomsScored: 1 });
    const sa = (await repo.getRoomScore(room.roomId, a))!;
    expect(sa).toMatchObject({ forecastRevision: 2, forecastProbabilityBps: 8000, resolvedOutcome: "yes", brierE8: 4_000_000, displayScoreC: 9600, finalizedAt: AFTER, forecastSubmittedAt: CUTOFF - 60_000 });
    expect((await repo.getRoomScore(room.roomId, b))!.displayScoreC).toBe(6400);
    expect(await repo.getRoomScore(room.roomId, late)).toBeNull();
    const fin = (await repo.getFinalization(MARKET))!;
    expect(fin).toMatchObject({ status: "scored", outcome: "yes", cutoffAt: CUTOFF, finalizedAt: AFTER, scoresWritten: 2 });
    expect(fin.provenance.chain.slot).toBe(455_123_456);
    expect(fin.provenance.panta.status).toBe("ok");
    expect((await repo.countPendingMarkets([a, late]))).toEqual({ [a]: 0, [late]: 0 });
  });

  it("12. idempotent: re-finalizing returns the stored record without fetching evidence or rescoring", async () => {
    const { repo } = make();
    const room = await seedRoom(repo);
    const w = newWallet();
    await forecast(repo, room, w, 8000, T0);
    const calls = { n: 0 };
    await finalizeMarket(evidenceDeps(repo, resolvedYes, calls), MARKET);
    const before = await repo.getRoomScore(room.roomId, w);
    const again = await finalizeMarket(evidenceDeps(repo, resolvedNo, calls), MARKET); // different "evidence" must not matter
    expect(again.result).toBe("already_finalized");
    expect(calls.n).toBe(1);
    expect(await repo.getRoomScore(room.roomId, w)).toEqual(before);
    expect((await repo.getReputation(w))!.scoredCount).toBe(1);
  });

  it("13. concurrent finalizations commit once (the other gets 'exists'); reputation not doubled", async () => {
    const { repo } = make();
    const room = await seedRoom(repo);
    const w = newWallet();
    await forecast(repo, room, w, 8000, T0);
    const results = await Promise.all([1, 2, 3].map(() => finalizeMarket(evidenceDeps(repo, resolvedYes), MARKET)));
    expect(results.filter((r) => r.result === "scored")).toHaveLength(1);
    expect(results.filter((r) => r.result === "already_finalized")).toHaveLength(2);
    expect(await repo.getReputation(w)).toMatchObject({ scoredCount: 1, sumBrierE8: 4_000_000 });
  });

  it("14. conflicting sources → persisted BLOCKED finalization, no scores, outcome never shown", async () => {
    const { repo } = make();
    const room = await seedRoom(repo);
    const w = newWallet();
    await forecast(repo, room, w, 8000, T0);
    const r = await finalizeMarket(evidenceDeps(repo, () => ({ detail: okDetail({ outcome: "no" }), chain: chain({ yesWins: true }) })), MARKET);
    expect(r.result).toBe("blocked");
    expect(await repo.getFinalization(MARKET)).toMatchObject({ status: "blocked", outcome: null, scoresWritten: 0 });
    expect(await repo.getRoomScore(room.roomId, w)).toBeNull();
    const lb = await roomLeaderboard(repo, room, 20, 0);
    expect(lb.status).toBe("blocked");
    expect(JSON.stringify(lb)).not.toMatch(/"outcome"/);
    // terminal: a later agreeing read doesn't silently rescore
    expect((await finalizeMarket(evidenceDeps(repo, resolvedYes), MARKET)).result).toBe("already_finalized");
  });

  it("15. global dedup across rooms: earliest participation counts once; each room keeps its own score", async () => {
    const { repo } = make();
    const r1 = await seedRoom(repo);
    const r2 = await seedRoom(repo);
    const w = newWallet();
    await forecast(repo, r2, w, 9000, T0 + 1_000); // joined r2 first
    await forecast(repo, r1, w, 2000, T0 + 2_000);
    await forecast(repo, r2, w, 7000, T0 + 3_000); // r2's final pre-cutoff revision
    await finalizeMarket(evidenceDeps(repo, resolvedYes), MARKET);
    expect((await repo.getRoomScore(r1.roomId, w))!.displayScoreC).toBe(3600);
    expect((await repo.getRoomScore(r2.roomId, w))!.displayScoreC).toBe(9100);
    const g = (await repo.getGlobalScore(w, MARKET))!;
    expect(g.roomId).toBe(r2.roomId);
    expect(g.forecastProbabilityBps).toBe(7000);
    expect((await repo.listGlobalScores(w, { limit: 10, offset: 0 })).total).toBe(1);
    expect(await repo.getReputation(w)).toMatchObject({ scoredCount: 1, sumBrierE8: 9_000_000 });
    const prof = await forecasterProfile(repo, w, 20, 0);
    expect(prof.rooms.find((x) => x.roomId === r2.roomId)!.countsGlobally).toBe(true);
    expect(prof.rooms.find((x) => x.roomId === r1.roomId)!.countsGlobally).toBe(false);
  });

  it("16. score records are immutable: commits can't overwrite, integrity check rejects forged scores", async () => {
    const { repo } = make();
    const room = await seedRoom(repo);
    const w = newWallet();
    await forecast(repo, room, w, 8000, T0);
    const snap = await repo.getMarketForecastSnapshot(MARKET);
    const forged = computeMarketScores(snap, "yes", CUTOFF, AFTER);
    forged.roomScores[0] = { ...forged.roomScores[0], forecastProbabilityBps: 10_000, brierE8: 0, displayScoreC: 10_000 };
    forged.globalScores[0] = forged.roomScores[0];
    const fin = { marketId: MARKET, status: "scored" as const, outcome: "yes" as const, cutoffAt: CUTOFF, finalizedAt: AFTER, provenance: decideResolution(MARKET, okDetail(), chain(), AFTER).provenance, roomsScored: 1, scoresWritten: 1, globalScoresWritten: 1 };
    await expect(repo.commitFinalization({ finalization: fin, ...forged })).rejects.toBeInstanceOf(FinalizationIntegrityError);
    expect(await repo.getFinalization(MARKET)).toBeNull();
    const real = computeMarketScores(snap, "yes", CUTOFF, AFTER);
    expect((await repo.commitFinalization({ finalization: fin, ...real })).status).toBe("committed");
    const flipped = computeMarketScores(snap, "no", CUTOFF, AFTER + 1);
    const res = await repo.commitFinalization({ finalization: { ...fin, outcome: "no", finalizedAt: AFTER + 1 }, ...flipped });
    expect(res.status).toBe("exists");
    expect((await repo.getRoomScore(room.roomId, w))!.resolvedOutcome).toBe("yes");
  });

  it("17. reputation aggregates, provisional vs ranked tiers, pagination and deterministic order", async () => {
    const { repo } = make();
    const markets = [MARKET, MARKET_2, newWallet(), newWallet(), newWallet()];
    const strong = newWallet();
    const weak = newWallet();
    const once = newWallet();
    for (const [i, m] of markets.entries()) {
      const room = await seedRoom(repo, m);
      await forecast(repo, room, strong, 9000, T0 + i);
      await forecast(repo, room, weak, 6000, T0 + i);
      if (i === 0) await forecast(repo, room, once, 10_000, T0);
      const deps = evidenceDeps(repo, () => ({ detail: okDetail({ marketId: m }), chain: chain() }));
      expect((await finalizeMarket(deps, m)).result).toBe("scored");
    }
    const ranked = await repo.listForecasters({ tier: "ranked", limit: 10, offset: 0 });
    expect(ranked.total).toBe(2);
    expect(ranked.items.map((r) => r.wallet)).toEqual([strong, weak]);
    expect(await repo.getRank(strong)).toBe(1);
    expect(await repo.getRank(weak)).toBe(2);
    expect(await repo.getRank(once)).toBeNull();
    const prov = await repo.listForecasters({ tier: "provisional", limit: 10, offset: 0 });
    expect(prov.items.map((r) => r.wallet)).toEqual([once]);
    expect(await repo.getReputation(strong)).toMatchObject({ scoredCount: 5, sumBrierE8: 5 * 1_000_000 });
    const page2 = await repo.listForecasters({ tier: "ranked", limit: 1, offset: 1 });
    expect(page2).toMatchObject({ total: 2 });
    expect(page2.items.map((r) => r.wallet)).toEqual([weak]);
    const view = await arenaPage(repo, "ranked", 1, 0);
    expect(view.items[0]).toMatchObject({ rank: 1, wallet: strong, ranked: true, scoredMarkets: 5, avgScore: "99.00", meanBrier: "0.0100", pendingMarkets: 0 });
    const pv = await arenaPage(repo, "provisional", 10, 0);
    expect(pv.items[0]).toMatchObject({ rank: null, ranked: false, scoredMarkets: 1 });
  });

  it("18. room leaderboard: in progress shows pending forecasts and no outcome; scored ranks by score", async () => {
    const { repo } = make();
    const room = await seedRoom(repo);
    const [a, b, c] = [newWallet(), newWallet(), newWallet()];
    await forecast(repo, room, a, 5800, T0);
    await forecast(repo, room, b, 9000, T0 + 1);
    await forecast(repo, room, c, 1000, T0 + 2);
    const before = await roomLeaderboard(repo, room, 20, 0);
    expect(before.status).toBe("in_progress");
    if (before.status !== "in_progress") return;
    expect(before.message).toBe(IN_PROGRESS_TEXT);
    expect(before.pending.total).toBe(3);
    expect(JSON.stringify(before)).not.toMatch(/"outcome"|"score"|"rank"/);
    await finalizeMarket(evidenceDeps(repo, resolvedNo), MARKET);
    const after = await roomLeaderboard(repo, room, 2, 0);
    expect(after.status).toBe("scored");
    if (after.status !== "scored") return;
    expect(after.outcome).toBe("no");
    expect(after.total).toBe(3);
    expect(after.scores.map((s) => [s.rank, s.wallet, s.score])).toEqual([
      [1, c, "99.00"],
      [2, a, "66.36"],
    ]);
    const p2 = await roomLeaderboard(repo, room, 2, 2);
    expect(p2.status === "scored" && p2.scores.map((s) => [s.rank, s.wallet])).toEqual([[3, b]]);
  });

  it("19. profile: pending markets, current forecast vs revisions vs finalized scores, unlisted rooms unlinked", async () => {
    const { repo } = make();
    const open = await seedRoom(repo, MARKET_2);
    const hidden = await seedRoom(repo, MARKET, { visibility: "unlisted" });
    const w = newWallet();
    await forecast(repo, open, w, 5000, T0);
    await forecast(repo, open, w, 5800, T0 + 10);
    await forecast(repo, hidden, w, 8000, T0 + 20);
    let p = await forecasterProfile(repo, w, 20, 0);
    expect(p).toMatchObject({ reputation: null, scoredMarkets: 0, pendingMarkets: 2 });
    const o = p.rooms.find((r) => r.roomId === open.roomId)!;
    expect(o).toMatchObject({ roomSlug: open.slug, marketStatus: "pending", roomScore: null });
    expect(o.current).toMatchObject({ probabilityBps: 5800, revision: 2 });
    expect(o.revisions.map((r) => r.revision).sort()).toEqual([1, 2]);
    expect(p.rooms.find((r) => r.roomId === hidden.roomId)).toMatchObject({ roomSlug: null, roomTitle: null });
    await finalizeMarket(evidenceDeps(repo, resolvedYes), MARKET);
    p = await forecasterProfile(repo, w, 20, 0);
    expect(p.pendingMarkets).toBe(1);
    expect(p.scores.total).toBe(1);
    expect(p.scores.items[0]).toMatchObject({ roomSlug: null, score: "96.00", outcome: "yes" });
    expect(p.reputation).toMatchObject({ ranked: false, scoredMarkets: 1 });
    expect(JSON.stringify(p)).not.toMatch(/session|nonce|signature|token/i);
  });

  it("20. finalizePending processes only unfinalized markets with forecasts (bounded batch)", async () => {
    const { repo } = make();
    const r1 = await seedRoom(repo, MARKET);
    const r2 = await seedRoom(repo, MARKET_2);
    await seedRoom(repo, newWallet()); // room without forecasts: never listed
    const w = newWallet();
    await forecast(repo, r1, w, 8000, T0);
    await forecast(repo, r2, w, 8000, T0 + 1);
    const ev = (id: string): ResolutionEvidence => (id === MARKET ? resolvedYes() : { detail: okDetail({ marketId: MARKET_2, resolved: false, outcome: undefined }), chain: chain({ resolved: false }) });
    const reports = await finalizePending({ repo, gatherEvidence: async (id) => ev(id), now: () => AFTER }, 10);
    expect(reports.map((r) => [r.marketId, r.result]).sort()).toEqual([[MARKET, "scored"], [MARKET_2, "not_resolved"]].sort());
    expect(await repo.listUnfinalizedMarkets({ limit: 10 })).toEqual([MARKET_2]);
  });
});

describe("storage-level immutability", () => {
  it("21. sqlite triggers refuse UPDATE/DELETE on finalizations, scores, global scores and reputation", async () => {
    const file = tmpDbFile();
    const repo = new SqliteRoomRepository(file);
    const room = await seedRoom(repo);
    const w = newWallet();
    await forecast(repo, room, w, 8000, T0);
    await finalizeMarket(evidenceDeps(repo, resolvedYes), MARKET);
    const { readFileSync } = await import("node:fs");
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(file));
    db.exec("PRAGMA foreign_keys = ON");
    for (const stmt of [
      "UPDATE market_finalizations SET status = 'blocked'",
      "DELETE FROM market_finalizations",
      "UPDATE forecast_scores SET display_score_c = 10000",
      "DELETE FROM forecast_scores",
      "UPDATE global_scores SET score_id = 'x'",
      "DELETE FROM global_scores",
      "UPDATE reputation SET scored_count = 0",
      "DELETE FROM reputation",
    ]) {
      expect(() => db.exec(stmt), stmt).toThrow();
    }
    db.close();
  });

  it("22. redis: the finalize Lua script refuses a second commit for the market (EXISTS)", async () => {
    const fake = new FakeRedis();
    const repo = new RedisRoomRepository(fake);
    const room = await seedRoom(repo);
    const w = newWallet();
    await forecast(repo, room, w, 8000, T0);
    await finalizeMarket(evidenceDeps(repo, resolvedYes), MARKET);
    const snap = await repo.getMarketForecastSnapshot(MARKET);
    const s = computeMarketScores(snap, "no", CUTOFF, AFTER + 5);
    const fin = { marketId: MARKET, status: "scored" as const, outcome: "no" as const, cutoffAt: CUTOFF, finalizedAt: AFTER + 5, provenance: decideResolution(MARKET, okDetail(), chain(), AFTER).provenance, roomsScored: 1, scoresWritten: 1, globalScoresWritten: 1 };
    expect((await repo.commitFinalization({ finalization: fin, ...s })).status).toBe("exists");
    expect((await repo.getRoomScore(room.roomId, w))!.resolvedOutcome).toBe("yes");
    expect((await repo.getReputation(w))!.scoredCount).toBe(1);
  });
});

// ---------------------------------------------------------------- HTTP routes

describe("arena HTTP routes", () => {
  type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
  let routes: { arena: Handler; finalize: Handler; profile: Handler; leaderboard: Handler };
  let repo: RoomRepository;
  const calls = { n: 0 };
  const TOKEN = "arena-test-token-0123456789abcdef0123456789";
  let ipSeq = 0;
  const req = (url: string, init: { method?: string; body?: unknown; auth?: string } = {}) => {
    const headers: Record<string, string> = { "x-vercel-forwarded-for": `198.51.100.${(++ipSeq % 250) + 1}` };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.auth) headers.authorization = init.auth;
    return new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  };

  beforeAll(async () => {
    routes = {
      arena: (await import("@/app/api/arena/route")).GET as Handler,
      finalize: (await import("@/app/api/arena/finalize/route")).POST as Handler,
      profile: (await import("@/app/api/forecasters/[wallet]/route")).GET as Handler,
      leaderboard: (await import("@/app/api/rooms/[slug]/leaderboard/route")).GET as Handler,
    };
    repo = new SqliteRoomRepository(tmpDbFile());
    __setRoomRepositoryForTests(repo);
    __setArenaDepsForTests({
      gatherEvidence: async () => {
        calls.n += 1;
        return resolvedYes();
      },
      now: () => AFTER,
    });
  });
  afterEach(() => {
    delete process.env.ROOMS_ADMIN_TOKEN;
  });
  afterAll(() => {
    __setRoomRepositoryForTests(undefined);
    __setArenaDepsForTests({});
  });

  it("23. finalize is protected: unset token → 503, wrong/missing → 401, client outcomes/scores rejected, no evidence fetched", async () => {
    const room = await seedRoom(repo);
    await forecast(repo, room, newWallet(), 8000, T0);
    let res = await routes.finalize(req("/api/arena/finalize", { method: "POST", body: { marketId: MARKET }, auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(503);
    process.env.ROOMS_ADMIN_TOKEN = TOKEN;
    res = await routes.finalize(req("/api/arena/finalize", { method: "POST", body: { marketId: MARKET } }));
    expect(res.status).toBe(401);
    res = await routes.finalize(req("/api/arena/finalize", { method: "POST", body: { marketId: MARKET }, auth: "Bearer wrong-token-wrong-token-wrong-token-xx" }));
    expect(res.status).toBe(401);
    for (const body of [{ marketId: MARKET, outcome: "yes" }, { roomSlug: room.slug, scores: [] }, { pending: true, limit: 99 }, {}]) {
      res = await routes.finalize(req("/api/arena/finalize", { method: "POST", body, auth: `Bearer ${TOKEN}` }));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(calls.n).toBe(0);
    expect(await repo.getFinalization(MARKET)).toBeNull();
    res = await routes.finalize(req("/api/arena/finalize", { method: "POST", body: { roomSlug: room.slug }, auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const j = await res.json();
    expect(j.reports[0]).toMatchObject({ marketId: MARKET, result: "scored", scoresWritten: 1 });
    expect(calls.n).toBe(1);
  });

  it("24. public reads never trigger finalization; wallet validated; leaderboard/arena/profile shapes", async () => {
    const before = calls.n;
    const room = await seedRoom(repo, MARKET_2);
    const w = newWallet();
    await forecast(repo, room, w, 5800, T0);
    const lb = await (await routes.leaderboard(req(`/api/rooms/${room.slug}/leaderboard`), { params: Promise.resolve({ slug: room.slug }) })).json();
    expect(lb).toMatchObject({ status: "in_progress", message: IN_PROGRESS_TEXT, pending: { total: 1 } });
    expect((await routes.leaderboard(req("/api/rooms/nope-nope/leaderboard"), { params: Promise.resolve({ slug: "nope-nope" }) })).status).toBe(404);
    const prof = await routes.profile(req(`/api/forecasters/${w}`), { params: Promise.resolve({ wallet: w }) });
    expect(prof.status).toBe(200);
    expect((await prof.json()).pendingMarkets).toBe(1);
    for (const bad of ["not-a-wallet", "0OIl" + "1".repeat(40), MARKET.slice(0, 20)]) {
      expect((await routes.profile(req(`/api/forecasters/${bad}`), { params: Promise.resolve({ wallet: bad }) })).status, bad).toBe(400);
    }
    const arena = await (await routes.arena(req("/api/arena?tier=provisional&limit=500"))).json();
    expect(arena.limit).toBe(50);
    expect(arena.methodology).toMatchObject({ minRankedMarkets: 5 });
    expect(calls.n).toBe(before);
  });
});
