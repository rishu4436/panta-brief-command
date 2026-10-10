/**
 * Phase 3 follow-up A: forecast eligibility must never be authorised by
 * cached data. The on-chain Event account is the authority for phase and
 * cutoff and is read fresh for every write (never shared with a read that
 * started earlier); Panta detail and the catalog row can only restrict; when
 * the chain is unreadable only a full detail fetched for this check counts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Market } from "@/lib/panta/domain";
import { decodeEventAccount } from "@/lib/panta/chain-events";
import { readEventAccount, readEventAccountFresh, type ChainEventRead } from "@/lib/panta/chain-event-server";
import { __resetWindowCachesForTests, checkForecastWindowForWrite, fetchForecastWindow, type WindowSources } from "@/lib/forecasts/window-server";
import { accountInfoReply, eventAccountBytes } from "./helpers/event-account";

const MARKET = "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn";
const NOW = Date.UTC(2026, 9, 10, 10, 0, 0);
const nowSec = Math.floor(NOW / 1000);
const PPE = nowSec + 19 * 3600;

const detail = (over: Partial<Market> = {}): Market => ({
  marketId: MARKET,
  title: "Haaland 8+ points, GW6",
  category: "sports",
  phase: "primary",
  status: "primary",
  endTime: nowSec + 30 * 3600,
  primaryPhaseEndTime: PPE,
  yesPrice: "0.4",
  noPrice: "0.6",
  ...over,
});
const chain = (o: Parameters<typeof eventAccountBytes>[0] = {}): ChainEventRead => ({
  status: "ok",
  event: decodeEventAccount(MARKET, eventAccountBytes({ nowSec, primaryPhaseEnd: PPE, end: nowSec + 30 * 3600, ...o }))!,
  slot: 1,
  fetchedAt: NOW,
});
const failedChain = (): ChainEventRead => ({ status: "failed", error: "RPC timed out", fetchedAt: NOW });
const src = (over: Partial<WindowSources>): WindowSources => ({
  readChain: async () => chain(),
  readDetail: async () => ({ detail: detail(), status: "ok", fetchedAt: NOW }),
  recentDetail: () => null,
  catalogRow: () => null,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetWindowCachesForTests();
});

describe("eligibility freshness (writes)", () => {
  it("write-path chain reads never share a request; page-view reads may", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n += 1;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify(accountInfoReply({})), { status: 200 });
    });
    await Promise.all([readEventAccountFresh(MARKET), readEventAccountFresh(MARKET), readEventAccountFresh(MARKET)]);
    expect(n).toBe(3);
    n = 0;
    await Promise.all([readEventAccount(MARKET), readEventAccount(MARKET)]);
    expect(n).toBe(1);
  });

  it("a write that arrives while a page-view chain read is in flight issues its own read and sees the transition", async () => {
    const rpcBodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("getAccountInfo")) {
        rpcBodies.push(body);
        const first = rpcBodies.length === 1;
        await new Promise((r) => setTimeout(r, first ? 60 : 5));
        // First (older) read: primary. The write's own read: graduated to secondary.
        return new Response(JSON.stringify(accountInfoReply({ nowSec, primaryPhaseEnd: PPE, end: nowSec + 30 * 3600, graduated: !first })), { status: 200 });
      }
      return new Response("{}", { status: 503 }); // Panta detail unavailable: can only restrict anyway
    });
    const pageRead = readEventAccount(MARKET);
    await new Promise((r) => setTimeout(r, 5));
    const w = await checkForecastWindowForWrite(MARKET, Date.now());
    const older = await pageRead;
    expect(rpcBodies).toHaveLength(2);
    expect(older.status === "ok" && older.event.isGraduated).toBe(false);
    expect(w.open).toBe(false);
  });

  it("chain says secondary / resolved / cancelled: cached detail and catalog row saying 'open' can't reopen it", async () => {
    for (const o of [{ graduated: true }, { resolved: true, yesWins: true }, { cancelled: true }, { active: false }]) {
      const w = await fetchForecastWindow(
        MARKET,
        NOW,
        src({ readChain: async () => chain(o), recentDetail: () => ({ detail: detail(), status: "ok", fetchedAt: NOW - 60_000 }), catalogRow: () => detail() }),
        () => NOW,
      );
      expect(w.open, JSON.stringify(o)).toBe(false);
    }
  });

  it("chain moves the cutoff earlier than the cached detail: the chain's cutoff wins", async () => {
    const early = nowSec - 60;
    const w = await fetchForecastWindow(
      MARKET,
      NOW,
      src({ readChain: async () => chain({ primaryPhaseEnd: early }), recentDetail: () => ({ detail: detail(), status: "ok", fetchedAt: NOW - 1000 }), catalogRow: () => detail() }),
      () => NOW,
    );
    expect(w).toMatchObject({ open: false });
  });

  it("chain unreadable: a thin fresh detail + a cached catalog row saying 'open' fails closed (the row is a cache)", async () => {
    for (const thin of [{ marketId: MARKET, partial: true } as Market, detail({ yesPrice: undefined, noPrice: undefined, phase: "unknown" as Market["phase"], status: "unknown" as Market["status"] })]) {
      const w = await fetchForecastWindow(
        MARKET,
        NOW,
        src({ readChain: async () => failedChain(), readDetailFresh: async () => ({ detail: thin, status: "ok", fetchedAt: NOW }), catalogRow: () => detail() }),
        () => NOW,
      );
      expect(w).toMatchObject({ open: false, reason: "unavailable" });
    }
    // a thin fresh record that already says secondary still closes with that reason
    const sec = await fetchForecastWindow(
      MARKET,
      NOW,
      src({ readChain: async () => failedChain(), readDetailFresh: async () => ({ detail: detail({ yesPrice: undefined, noPrice: undefined, phase: "secondary", status: "secondary" }), status: "ok", fetchedAt: NOW }), catalogRow: () => detail() }),
      () => NOW,
    );
    expect(sec.open).toBe(false);
  });

  it("chain unreadable: the recent (cached) detail is ignored; only the detail fetched for this check counts", async () => {
    const calls = { fresh: 0 };
    const w = await fetchForecastWindow(
      MARKET,
      NOW,
      src({
        readChain: async () => failedChain(),
        recentDetail: () => ({ detail: detail(), status: "ok", fetchedAt: NOW - 1000 }),
        readDetailFresh: async () => {
          calls.fresh += 1;
          return { detail: null, status: "failed", fetchedAt: NOW };
        },
      }),
      () => NOW,
    );
    expect(calls.fresh).toBe(1);
    expect(w).toMatchObject({ open: false, reason: "unavailable" });
    const ok = await fetchForecastWindow(MARKET, NOW, src({ readChain: async () => failedChain(), readDetailFresh: async () => ({ detail: detail(), status: "ok", fetchedAt: NOW }) }), () => NOW);
    expect(ok.open).toBe(true);
  });
});
