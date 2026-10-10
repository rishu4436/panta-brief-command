/**
 * Regression tests for the Phase 2 UX fixes:
 *  A. forecast eligibility latency + cold start (bounded sources, chain as the
 *     authorising fresh read, shared in-flight reads, caches can't authorise)
 *  B. the POST returns the committed community aggregate and the client puts
 *     it into the query cache (no stale flash)
 *  C. after a save the panel's data is the committed forecast (read-only summary)
 *  D. slider keyboard step = 1 point; the number field keeps 0.01 % precision
 *  E. mobile marker placement (no overflow / collisions at 0 %, 100 %, close values)
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Market } from "@/lib/panta/domain";
import { decodeEventAccount, PANTA_PROGRAM_ID } from "@/lib/panta/chain-events";
import { interpretEventAccountReply, readEventAccount, type ChainEventRead } from "@/lib/panta/chain-event-server";
import { fetchForecastWindow, DETAIL_BUDGET_MS, type WindowSources } from "@/lib/forecasts/window-server";
import { evaluateForecastWindow } from "@/lib/forecasts/window";
import { applyCommittedForecast, forecastKeys, type MyForecastResponse, type RoomForecastsResponse } from "@/lib/forecasts/client";
import { SubmitForecastInput, markerPlacement, percentToBps, sliderKeyBps, snapSliderBps } from "@/lib/forecasts/domain";
import { submitForecast } from "@/lib/forecasts/service";
import { newRoomId } from "@/lib/rooms/service";
import { SqliteRoomRepository } from "@/lib/rooms/store/sqlite";
import { accountInfoReply, eventAccountBytes } from "./helpers/event-account";

const MARKET = "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn";
const NOW = Date.UTC(2026, 9, 10, 10, 0, 0);
const nowSec = Math.floor(NOW / 1000);

const detail = (over: Partial<Market> = {}): Market => ({
  marketId: MARKET,
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

const chainOk = (o: Parameters<typeof eventAccountBytes>[0] = {}): ChainEventRead => ({
  status: "ok",
  event: decodeEventAccount(MARKET, eventAccountBytes({ nowSec, primaryPhaseEnd: nowSec + 19 * 3600, end: nowSec + 30 * 3600, ...o }))!,
  slot: 1,
  fetchedAt: NOW,
});

function sources(over: Partial<WindowSources> & { detailCalls?: { n: number } } = {}): WindowSources {
  const calls = over.detailCalls ?? { n: 0 };
  return {
    readChain: async () => chainOk(),
    readDetail: async () => {
      calls.n += 1;
      return { detail: detail(), status: "ok", fetchedAt: NOW };
    },
    recentDetail: () => null,
    catalogRow: () => null,
    ...over,
  };
}

const never = <T,>() => new Promise<T>(() => undefined);

describe("A. eligibility: bounded, chain-authorised, fail closed", () => {
  it("a slow Panta detail no longer blocks: answer within the detail budget when the chain read is fresh", async () => {
    const t0 = Date.now();
    const w = await fetchForecastWindow(MARKET, NOW, sources({ readDetail: () => never() }), () => NOW);
    expect(Date.now() - t0).toBeLessThan(DETAIL_BUDGET_MS + 700);
    expect(w).toMatchObject({ open: true, cutoffAt: (nowSec + 19 * 3600) * 1000 });
  });

  it("cold start: no catalog yet + priceless detail is fine when the fresh chain read says primary-open (was 'couldn't be reached')", async () => {
    const thin = detail({ yesPrice: null, noPrice: null });
    // Old policy (no chain): fail closed.
    expect(evaluateForecastWindow({ row: null, detail: { ...thin, title: "", partial: true }, detailStatus: "ok", nowMs: NOW })).toMatchObject({ open: false, reason: "unavailable" });
    const w = await fetchForecastWindow(MARKET, NOW, sources({ readDetail: async () => ({ detail: thin, status: "ok", fetchedAt: NOW }) }), () => NOW);
    expect(w.open).toBe(true);
  });

  it("a cached 'open' detail can't override what the fresh chain read shows (graduated / resolved / cancelled / inactive)", async () => {
    const recent = () => ({ detail: detail(), status: "ok" as const, fetchedAt: NOW - 1000 });
    for (const [o, reason] of [
      [{ graduated: true }, "secondary"],
      [{ resolved: true, yesWins: true }, "resolved"],
      [{ cancelled: true }, "cancelled"],
      [{ active: false }, "unknown"],
    ] as const) {
      const w = await fetchForecastWindow(MARKET, NOW, sources({ readChain: async () => chainOk(o), recentDetail: recent }), () => NOW);
      expect(w).toMatchObject({ open: false, reason });
    }
  });

  it("a detail (cached or fresh) that shows the market closed still closes it, whatever the chain says", async () => {
    const w = await fetchForecastWindow(
      MARKET,
      NOW,
      sources({ recentDetail: () => ({ detail: detail({ phase: "secondary", status: "secondary" }), status: "ok", fetchedAt: NOW - 500 }) }),
      () => NOW,
    );
    expect(w).toMatchObject({ open: false, reason: "secondary" });
  });

  it("cutoff is re-checked against the server clock at decision time, not when the request started", async () => {
    const cutoffSec = nowSec + 2;
    let clock = NOW;
    const src = sources({
      readChain: async () => {
        clock = cutoffSec * 1000; // the chain read finished exactly at the cutoff
        return chainOk({ primaryPhaseEnd: cutoffSec });
      },
    });
    const w = await fetchForecastWindow(MARKET, NOW, src, () => clock);
    // Closed (the canonical lifecycle already reports the primary window as ended at the cutoff).
    expect(w.open).toBe(false);
    expect(["ended", "cutoff_passed"]).toContain(!w.open && w.reason);
    // One second earlier the same sources are open.
    const w2 = await fetchForecastWindow(MARKET, NOW, sources({ readChain: async () => chainOk({ primaryPhaseEnd: cutoffSec }) }), () => cutoffSec * 1000 - 1000);
    expect(w2.open).toBe(true);
  });

  it("chain unreadable: a reused (cached) detail never authorises; a fresh one is fetched, and its failure fails closed", async () => {
    const calls = { n: 0 };
    const w = await fetchForecastWindow(
      MARKET,
      NOW,
      sources({
        detailCalls: calls,
        readChain: async () => ({ status: "failed", error: "RPC timed out", fetchedAt: NOW }),
        recentDetail: () => ({ detail: detail(), status: "ok", fetchedAt: NOW - 1000 }),
        readDetail: async () => {
          calls.n += 1;
          return { detail: null, status: "failed", fetchedAt: NOW };
        },
      }),
      () => NOW,
    );
    expect(calls.n).toBe(1);
    expect(w).toMatchObject({ open: false, reason: "unavailable" });
  });

  it("chain unreadable + fresh full detail: old policy still allows (detail is the fresh authorising read)", async () => {
    const w = await fetchForecastWindow(MARKET, NOW, sources({ readChain: async () => ({ status: "failed", error: "x", fetchedAt: NOW }) }), () => NOW);
    expect(w.open).toBe(true);
  });

  it("no Event account (or wrong owner) → not_found; chain without primaryPhaseEndTime → no_cutoff", async () => {
    expect(await fetchForecastWindow(MARKET, NOW, sources({ readChain: async () => ({ status: "not_found", slot: 1, fetchedAt: NOW }) }), () => NOW)).toMatchObject({ open: false, reason: "not_found" });
    expect(interpretEventAccountReply(MARKET, accountInfoReply({}, 5, "11111111111111111111111111111111"), NOW).status).toBe("not_found");
    expect(interpretEventAccountReply(MARKET, { result: { context: { slot: 5 }, value: null } }, NOW).status).toBe("not_found");
    const ok = interpretEventAccountReply(MARKET, accountInfoReply({ resolved: true, yesWins: true }, 777), NOW);
    expect(ok).toMatchObject({ status: "ok", slot: 777 });
    const noPpe = await fetchForecastWindow(MARKET, NOW, sources({ readChain: async () => chainOk({ primaryPhaseEnd: 0 }) }), () => NOW);
    expect(noPpe).toMatchObject({ open: false, reason: "no_cutoff" });
  });

  it("concurrent chain reads for one market share ONE RPC request (in-flight dedup), then read fresh again", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify(accountInfoReply({})), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const rs = await Promise.all([readEventAccount(MARKET), readEventAccount(MARKET), readEventAccount(MARKET)]);
      expect(n).toBe(1);
      expect(rs.every((r) => r.status === "ok")).toBe(true);
      await readEventAccount(MARKET);
      expect(n).toBe(2); // no result caching
      expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body))).toMatchObject({
        method: "getAccountInfo",
        params: [MARKET, { encoding: "base64", commitment: "confirmed" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an RPC timeout is a failure (never 'open')", async () => {
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    try {
      expect(await readEventAccount(MARKET)).toMatchObject({ status: "failed", error: "RPC timed out" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(PANTA_PROGRAM_ID).toMatch(/^6gM5/);
  });
});

// ------------------------------------------------------------------ B + C

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
afterEach(() => vi.unstubAllGlobals());

describe("B. committed aggregate returned and applied", () => {
  it("the submit result carries the committed community aggregate (includes this forecast)", async () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "fux-"));
    dirs.push(d);
    const repo = new SqliteRoomRepository(path.join(d, "r.sqlite"));
    const roomId = newRoomId();
    await repo.createRoom(
      { roomId, slug: "ux-room", title: "t", description: "", creatorWallet: "Ev1eLYiVCkSm5UZLJVUdHs2yAvKZUB1jMNjEpYTDHXhh", marketId: MARKET, visibility: "public", createdAt: NOW },
      { key: "ux-room-key-000000", fingerprint: "f" },
    );
    const room = (await repo.getRoomById(roomId))!;
    const deps = { repo, checkWindow: async () => ({ open: true as const, cutoffAt: NOW + 3600_000, lifecycle: "open" as const, checkedAt: NOW }), now: () => NOW };
    const a = await submitForecast(deps, "2hRywEn4jKKDdgSHjuWVTa7UWAU9kqkp13st5sfMxiSJ", room, SubmitForecastInput.parse({ roomId, probabilityBps: 7000, expectedRevision: 0, idempotencyKey: "ux-key-a-00000000" }));
    expect(a.consensus).toMatchObject({ kind: "consensus", participants: 1, meanBps: 7000 });
    const b = await submitForecast(deps, "FZyJXaSXFyAGf4CPqBNLZWzzkmZn1ygbrWzNMNaFkhgn", room, SubmitForecastInput.parse({ roomId, probabilityBps: 5000, expectedRevision: 0, idempotencyKey: "ux-key-b-00000000" }));
    expect(b.consensus).toMatchObject({ kind: "consensus", participants: 2, meanBps: 6000 });
  });

  it("applyCommittedForecast sets consensus + list + my forecast at once and an in-flight older GET can't overwrite it", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const slug = "ux-room";
    const W = "2hRywEn4jKKDdgSHjuWVTa7UWAU9kqkp13st5sfMxiSJ";
    const old: RoomForecastsResponse = {
      roomId: "room_x",
      marketId: MARKET,
      window: { open: true, reason: null, message: null, cutoffAt: new Date(NOW + 3600_000).toISOString(), lifecycle: "open", checkedAt: new Date(NOW).toISOString() },
      consensus: { kind: "empty", participants: 0, buckets: Array(10).fill(0) },
      forecasts: [],
      total: 0,
      limit: 10,
      offset: 0,
    };
    // A slow refetch that started BEFORE the commit and would return the stale (empty) page.
    let resolveStale!: (v: RoomForecastsResponse) => void;
    qc.setQueryData(forecastKeys.page(slug, 0, 10), old);
    const stale = qc.fetchQuery({ queryKey: forecastKeys.page(slug, 0, 10), queryFn: () => new Promise<RoomForecastsResponse>((r) => (resolveStale = r)), staleTime: 0 });
    const f = { forecastId: "fc_000000000000000000000001", roomId: "room_x", wallet: W, probabilityBps: 7000, reasoning: "r", revision: 1, createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };
    await applyCommittedForecast(qc, slug, { status: "created", forecast: f, consensus: { kind: "consensus", participants: 1, meanBps: 7000, buckets: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0] } });
    resolveStale(old);
    await stale.catch(() => undefined);
    const page = qc.getQueryData<RoomForecastsResponse>(forecastKeys.page(slug, 0, 10))!;
    expect(page.consensus).toMatchObject({ kind: "consensus", participants: 1, meanBps: 7000 });
    expect(page.forecasts.map((x) => x.wallet)).toEqual([W]);
    expect(page.total).toBe(1);
    // C: my forecast is the committed one → the panel renders the read-only summary, not the empty form.
    const mine = qc.getQueryData<MyForecastResponse>(forecastKeys.mine(slug, W))!;
    expect(mine.current).toMatchObject({ revision: 1, probabilityBps: 7000 });
    expect(mine.history).toEqual([{ revision: 1, probabilityBps: 7000, reasoning: "r", createdAt: f.updatedAt }]);
    qc.clear();
  });

  it("C. a revision updates history newest-first and replaces the wallet's row at the top", async () => {
    const qc = new QueryClient();
    const slug = "s";
    const W = "2hRywEn4jKKDdgSHjuWVTa7UWAU9kqkp13st5sfMxiSJ";
    const base = { forecastId: "fc_000000000000000000000001", roomId: "room_x", wallet: W, reasoning: "", createdAt: new Date(NOW).toISOString() };
    qc.setQueryData<MyForecastResponse>(forecastKeys.mine(slug, W), {
      wallet: W,
      current: { ...base, probabilityBps: 7000, revision: 1, updatedAt: new Date(NOW).toISOString() },
      history: [{ revision: 1, probabilityBps: 7000, reasoning: "", createdAt: new Date(NOW).toISOString() }],
    });
    const other = { ...base, forecastId: "fc_000000000000000000000002", wallet: "FZyJXaSXFyAGf4CPqBNLZWzzkmZn1ygbrWzNMNaFkhgn", probabilityBps: 5000, revision: 1, updatedAt: new Date(NOW + 1).toISOString() };
    qc.setQueryData(forecastKeys.page(slug, 0, 10), {
      consensus: { kind: "consensus", participants: 2, meanBps: 6000, buckets: [] },
      forecasts: [other, { ...base, probabilityBps: 7000, revision: 1, updatedAt: new Date(NOW).toISOString() }],
      total: 2,
      limit: 10,
      offset: 0,
    });
    const rev2 = { ...base, probabilityBps: 6500, revision: 2, updatedAt: new Date(NOW + 5000).toISOString() };
    await applyCommittedForecast(qc, slug, { status: "revised", forecast: rev2, consensus: { kind: "consensus", participants: 2, meanBps: 5750, buckets: [] } });
    const mine = qc.getQueryData<MyForecastResponse>(forecastKeys.mine(slug, W))!;
    expect(mine.history.map((h) => h.revision)).toEqual([2, 1]);
    expect(mine.current?.revision).toBe(2);
    const page = qc.getQueryData<RoomForecastsResponse>(forecastKeys.page(slug, 0, 10))!;
    expect(page.forecasts.map((x) => [x.wallet.slice(0, 4), x.probabilityBps])).toEqual([["2hRy", 6500], ["FZyJ", 5000]]);
    expect(page.consensus).toMatchObject({ meanBps: 5750 });
    expect(page.total).toBe(2);
    qc.clear();
  });
});

describe("D. slider keyboard step and precise input", () => {
  it("arrow keys move exactly 1 percentage point; page keys 10; Home/End bounds; clamped", () => {
    expect(sliderKeyBps("ArrowRight", 5000)).toBe(5100);
    expect(sliderKeyBps("ArrowUp", 5000)).toBe(5100);
    expect(sliderKeyBps("ArrowLeft", 5000)).toBe(4900);
    expect(sliderKeyBps("ArrowDown", 5000)).toBe(4900);
    expect(sliderKeyBps("PageUp", 5000)).toBe(6000);
    expect(sliderKeyBps("PageDown", 5000)).toBe(4000);
    expect(sliderKeyBps("Home", 5000)).toBe(0);
    expect(sliderKeyBps("End", 5000)).toBe(10000);
    expect(sliderKeyBps("ArrowRight", 10000)).toBe(10000);
    expect(sliderKeyBps("ArrowLeft", 0)).toBe(0);
    expect(sliderKeyBps("a", 5000)).toBeNull();
  });

  it("from a precise typed value an arrow goes to the next whole point (never more than 1 point)", () => {
    expect(sliderKeyBps("ArrowRight", 6237)).toBe(6300);
    expect(sliderKeyBps("ArrowLeft", 6237)).toBe(6200);
    expect(sliderKeyBps("ArrowRight", 9999)).toBe(10000);
  });

  it("drags snap to whole points; the number field keeps 0.01 % (1 bps) precision", () => {
    expect(snapSliderBps(6237)).toBe(6200);
    expect(snapSliderBps(6251)).toBe(6300);
    expect(percentToBps("0.01")).toBe(1);
    expect(percentToBps("62.37")).toBe(6237);
    expect(percentToBps(".5")).toBe(50);
    expect(percentToBps("100")).toBe(10000);
    expect(percentToBps("62.375")).toBeNull();
    expect(percentToBps("100.01")).toBeNull();
  });
});

describe("E. mobile: histogram marker labels stay inside and don't collide", () => {
  it("edge labels align inward at 0 % and 100 %", () => {
    expect(markerPlacement(0, null).align).toBe("start");
    expect(markerPlacement(10000, null).align).toBe("end");
    expect(markerPlacement(5000, null).align).toBe("center");
  });
  it("'You' drops below the bars when close to 'Avg'", () => {
    expect(markerPlacement(6500, 5750).below).toBe(true);
    expect(markerPlacement(9000, 5000).below).toBe(false);
    expect(markerPlacement(5000, null).below).toBe(false);
  });
});
