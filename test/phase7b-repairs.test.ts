/**
 * Phase 7B: repairs from real Phantom QA.
 *  1. One forecast eligibility for room panel, Studio and writes.
 *  2. Portfolio exposure empty / unavailable states.
 *  3. Cross-tab session sync (hint only; the server session decides).
 *  4. Wallet-menu "Sign out".
 */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "@/lib/embed/market-snapshot";
import { FORM_MODES, yourForecastMode, type YourForecastInput } from "@/lib/forecasts/panel-mode";
import { ForecastingClosedError, submitForecast } from "@/lib/forecasts/service";
import { evaluateForecastWindow, FORECAST_CLOSED_TEXT, type ForecastWindow } from "@/lib/forecasts/window";
import { ELIGIBILITY_TEXT, forecastEligibility, publicWindow } from "@/lib/forecasts/window-public";
import type { Market } from "@/lib/panta/domain";
import { exposureNote, exposureView, NO_POSITIONS_NOTE, portfolioReadState, POSITIONS_READ_FAILED_NOTE } from "@/lib/panta/exposure-view";
import { LARGEST_UNAVAILABLE_NOTE, portfolioIntel } from "@/lib/panta/position-intel";
import type { RoomRecord } from "@/lib/rooms/domain";
import { roomKeys, signOutAndRefresh, verifyWalletOwnership } from "@/lib/rooms/client";
import { createSessionSync, expiryDelayMs, parseSyncMessage, SESSION_SYNC_CHANNEL, SESSION_SYNC_STORAGE_KEY, signInEvent, type SessionSyncEvent } from "@/lib/rooms/session-sync";
import type { RoomRepository } from "@/lib/rooms/store";
import { forecastingState, listStudioRooms, toRow, type StudioDeps } from "@/lib/studio/service";
import { walletMenuItems } from "@/lib/wallet-menu";

const NOW = Date.UTC(2026, 9, 10, 13, 0, 0);
const nowSec = Math.floor(NOW / 1000);
const MARKET = "6Yb4XxWdVnJ4Gm3o1zFv1rS7ZcCq2y5Lq7mGkQ2pZt9a";
const CREATOR = "8h6tvqz6NgA3VrNELmkGhsZgHPr9uQaVfYL2DVKBoyMP";

const market = (over: Partial<Market> = {}): Market => ({
  marketId: MARKET,
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

const room = (over: Partial<RoomRecord> = {}): RoomRecord => ({
  roomId: "room_phantom_0001",
  slug: "test-phantom-sign-in-room",
  title: "Phantom sign-in room",
  description: "",
  creatorWallet: CREATOR,
  marketId: MARKET,
  visibility: "public",
  status: "active",
  createdAt: NOW - 86_400_000,
  updatedAt: NOW - 86_400_000,
  ...over,
});

const openW: ForecastWindow = { open: true, cutoffAt: NOW + 3_600_000, lifecycle: "open", checkedAt: NOW };

const okSnap = (m: Market): MarketSnapshot => ({ status: "ok", market: m, ageMs: 0, sourcesAgreeResolved: null, chainOk: true, detailOk: true, fetchedAt: NOW }) as unknown as MarketSnapshot;

/** Windows the real evaluator returns for each case (not hand-built). */
const WINDOWS: Record<string, ForecastWindow> = {
  "primary-open": evaluateForecastWindow({ row: market({ sources: { list: true, chain: true, detail: true } }), detail: market(), detailStatus: "ok", nowMs: NOW }),
  secondary: evaluateForecastWindow({ detail: market({ phase: "secondary", status: "secondary", primaryPhaseEndTime: nowSec - 3600 }), detailStatus: "ok", nowMs: NOW }),
  closed: evaluateForecastWindow({ detail: market({ primaryPhaseEndTime: nowSec - 1 }), detailStatus: "ok", nowMs: NOW }),
  resolved: evaluateForecastWindow({ detail: market({ phase: "resolved", resolved: true, outcome: "no" }), detailStatus: "ok", nowMs: NOW }),
  cancelled: evaluateForecastWindow({ detail: market({ phase: "cancelled", status: "cancelled" }), detailStatus: "ok", nowMs: NOW }),
  unknown: evaluateForecastWindow({ detail: market({ phase: "" as Market["phase"], status: undefined }), detailStatus: "ok", nowMs: NOW }),
  stale: evaluateForecastWindow({ row: market({ sources: { list: true, chain: true, detail: true } }), detail: market({ phase: "secondary", status: "secondary" }), detailStatus: "ok", nowMs: NOW }),
  unavailable: evaluateForecastWindow({ row: market(), detail: null, detailStatus: "failed", nowMs: NOW }),
};

const EXPECTED: Record<string, "open" | "closed" | "unknown"> = {
  "primary-open": "open",
  secondary: "closed",
  closed: "closed",
  resolved: "closed",
  cancelled: "closed",
  unknown: "unknown",
  stale: "closed",
  unavailable: "unknown",
};

const allPanelInputs = (eligibility: YourForecastInput["eligibility"]): YourForecastInput[] => {
  const out: YourForecastInput[] = [];
  for (const connected of [false, true])
    for (const sessionPending of [false, true])
      for (const verified of [false, true])
        for (const minePending of [false, true])
          for (const mineError of [false, true])
            for (const hasCurrent of [false, true])
              for (const editing of [false, true]) out.push({ eligibility, connected, sessionPending, verified, minePending, mineError, hasCurrent, editing });
  return out;
};

// ---------------------------------------------------------------- 1. forecast eligibility

describe("forecast eligibility: one decision for room panel and Studio", () => {
  it.each(Object.keys(WINDOWS))("%s → room panel and Studio show the same state", (k) => {
    const w = WINDOWS[k];
    const panel = forecastEligibility(publicWindow(w));
    expect(panel).toBe(EXPECTED[k]);
    expect(forecastingState(room(), null, w)).toBe(panel);
    // Studio row built from a snapshot that still says "Primary · open" (stale cache) follows the window.
    const row = toRow(room(), null, null, okSnap(market()), NOW, w);
    expect(row.forecasting).toBe(panel);
    expect(ELIGIBILITY_TEXT[panel]).toMatch(/^Forecasting (open|closed|paused)$/);
    if (!w.open) expect(row.forecastingMessage).toBe(w.message);
  });

  it("secondary room (the real QA case): closed with the secondary message, not 'Forecasting open'", () => {
    const row = toRow(room(), null, null, okSnap(market({ phase: "secondary", status: "secondary", primaryPhaseEndTime: nowSec - 3600 })), NOW, WINDOWS.secondary);
    expect(row.forecasting).toBe("closed");
    expect(row.lifecycleLabel).not.toMatch(/open/i);
    expect(row.forecastingMessage).toBe(FORECAST_CLOSED_TEXT.secondary);
  });

  it("without a server window Studio never says open, even when the cached snapshot is primary/trading", () => {
    expect(toRow(room(), null, null, okSnap(market()), NOW, null).forecasting).toBe("unknown");
    expect(toRow(room(), null, null, okSnap(market({ phase: "secondary", status: "secondary" })), NOW, null).forecasting).toBe("unknown");
    expect(forecastingState(room({ status: "archived" }), null, openW)).toBe("archived");
  });

  it.each(Object.keys(WINDOWS).filter((k) => EXPECTED[k] !== "open"))("%s: the forecast form (slider + Submit) is never rendered", (k) => {
    const elig = forecastEligibility(publicWindow(WINDOWS[k]));
    for (const i of allPanelInputs(elig)) expect(FORM_MODES.has(yourForecastMode(i))).toBe(false);
  });

  it("primary-open + verified wallet → the form; a saved forecast → current card with Edit", () => {
    const base = { eligibility: "open" as const, connected: true, sessionPending: false, verified: true, minePending: false, mineError: false, editing: false };
    expect(yourForecastMode({ ...base, hasCurrent: false })).toBe("form");
    expect(yourForecastMode({ ...base, hasCurrent: true })).toBe("current");
    expect(yourForecastMode({ ...base, hasCurrent: true, editing: true })).toBe("form");
  });

  it("history stays visible after closure: verified wallet with a forecast → read-only current card (history renders under it)", () => {
    const i = { eligibility: "closed" as const, connected: true, sessionPending: false, verified: true, minePending: false, mineError: false, hasCurrent: true };
    expect(yourForecastMode({ ...i, editing: false })).toBe("closed-current");
    // Window closed mid-edit: the open form is replaced, the saved forecast stays.
    expect(yourForecastMode({ ...i, editing: true })).toBe("closed-current");
    // Connected but not signed in: offered sign-in to SEE history, not to forecast.
    expect(yourForecastMode({ ...i, editing: false, verified: false })).toBe("closed-verify");
    expect(yourForecastMode({ ...i, editing: false, connected: false })).toBe("closed");
  });

  it("stale client: a cached 'open' page can't authorise a write; the fresh write check rejects and nothing is stored", async () => {
    const touched: string[] = [];
    const repo = new Proxy({} as RoomRepository, {
      get: (_t, prop) => async () => {
        touched.push(String(prop));
        throw new Error("must not be called");
      },
    });
    const readCache = async () => openW; // what the page saw a minute ago
    expect((await readCache()).open).toBe(true);
    const checkWindow = async () => WINDOWS.stale; // fresh: Panta moved the market to secondary
    const input = { roomId: room().roomId, probabilityBps: 6000, reasoning: "", expectedRevision: 0, idempotencyKey: "phase7b-stale-0001" };
    await expect(submitForecast({ repo, checkWindow, now: () => NOW }, CREATOR, room(), input)).rejects.toBeInstanceOf(ForecastingClosedError);
    expect(touched).toEqual([]);
  });

  it("Studio list: same window function; slow or failing check → paused, never open", async () => {
    const repo = {
      listCreatorRoomsAll: async () => [room(), room({ roomId: "room_phantom_0002", slug: "slow-room" }), room({ roomId: "room_phantom_0003", slug: "failing-room" })],
      getForecastAggregate: async () => {
        throw new Error("no aggregate in this test");
      },
      getFinalization: async () => null,
    } as unknown as RoomRepository;
    vi.useFakeTimers();
    try {
      const deps: StudioDeps = {
        repo,
        now: () => NOW,
        origin: "http://localhost:3100",
        snapshot: async () => okSnap(market()),
        window: () => {
          const n = calls++;
          if (n === 0) return Promise.resolve(WINDOWS.secondary);
          if (n === 1) return new Promise<ForecastWindow>(() => undefined);
          return Promise.reject(new Error("panta down"));
        },
      };
      let calls = 0;
      const p = listStudioRooms(deps, CREATOR, { q: "", status: "all", page: 1 });
      await vi.advanceTimersByTimeAsync(3_100);
      const page = await p;
      expect(page.items.map((r) => [r.slug, r.forecasting])).toEqual([
        ["test-phantom-sign-in-room", "closed"],
        ["slow-room", "unknown"],
        ["failing-room", "unknown"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------- 2. exposure states

describe("portfolio exposure states", () => {
  it("confirmed empty wallet → 'No open exposure', not 'valid marks required'", () => {
    const intel = portfolioIntel([]);
    const v = exposureView(portfolioReadState({ hasData: true, isError: false }), intel);
    expect(v).toBe("empty");
    expect(exposureNote("empty")).toBe(NO_POSITIONS_NOTE);
    expect(NO_POSITIONS_NOTE).toMatch(/^No open exposure/);
    expect(NO_POSITIONS_NOTE).not.toMatch(/valid marks/);
  });

  it("positions held but no valid valuation → honest unavailable-valuation note", () => {
    const v = exposureView("loaded", { positionCount: 2, marksPending: false, noValidMarks: true, totalValidMarked: 0 });
    expect(v).toBe("valuation-unavailable");
    expect(exposureNote(v as "valuation-unavailable")).toBe(LARGEST_UNAVAILABLE_NOTE);
    expect(exposureView("loaded", { positionCount: 2, marksPending: true, noValidMarks: true, totalValidMarked: 0 })).toBe("marks-pending");
  });

  it("valid marks → normal view; all-zero valid marks → zero exposure", () => {
    expect(exposureView("loaded", { positionCount: 1, marksPending: false, noValidMarks: false, totalValidMarked: 12.5 })).toBe("valued");
    expect(exposureView("loaded", { positionCount: 1, marksPending: false, noValidMarks: false, totalValidMarked: 0 })).toBe("zero");
  });

  it("failed or unfinished read never shows empty / zero", () => {
    const intel = portfolioIntel([]);
    expect(portfolioReadState({ hasData: false, isError: true })).toBe("failed");
    expect(exposureView("failed", intel)).toBe("read-failed");
    expect(exposureNote("read-failed")).toBe(POSITIONS_READ_FAILED_NOTE);
    expect(exposureView(portfolioReadState({ hasData: false, isError: false }), intel)).toBe("loading");
    // A failed REFETCH keeps the last good read (data present).
    expect(portfolioReadState({ hasData: true, isError: true })).toBe("loaded");
  });
});

// ---------------------------------------------------------------- 3. cross-tab session

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** A tab: its own QueryClient whose session query reads the (mocked) server. */
function tab(serverSession: () => { wallet: string | null; expiresAt: string | null }, transport?: "storage", bus?: EventTarget) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stored = new Map<string, string>();
  const reads = { n: 0 };
  const read = async () => {
    reads.n++;
    return serverSession();
  };
  const storage = bus
    ? {
        setItem: (k: string, v: string) => {
          stored.set(k, v);
          bus.dispatchEvent(Object.assign(new Event("storage"), { key: k, newValue: v, src: sync }));
        },
        removeItem: (k: string) => void stored.delete(k),
      }
    : null;
  const sync = createSessionSync(
    transport === "storage"
      ? {
          createChannel: null,
          storage,
          onStorage: (fn) => {
            const h = (e: Event) => {
              const se = e as Event & { key: string; newValue: string; src: unknown };
              if (se.src !== sync) fn({ key: se.key, newValue: se.newValue }); // storage events skip the writer
            };
            bus!.addEventListener("storage", h);
            return () => bus!.removeEventListener("storage", h);
          },
        }
      : { createChannel: (name) => new BroadcastChannel(name) as never },
  );
  const received: SessionSyncEvent[] = [];
  sync.subscribe((t) => {
    received.push(t);
    void qc.invalidateQueries({ queryKey: roomKeys.session() });
  });
  const observe = () => qc.fetchQuery({ queryKey: roomKeys.session(), queryFn: read, staleTime: Infinity });
  // Keep an observer so invalidation refetches (like a mounted useRoomSession).
  const unsub = qc.getQueryCache().subscribe(() => undefined);
  return { qc, sync, reads, received, stored, observe, wallet: () => (qc.getQueryData(roomKeys.session()) as { wallet: string | null } | undefined)?.wallet ?? null, close: () => (unsub(), sync.close(), qc.clear()) };
}

describe("cross-tab session sync", () => {
  const open: { close: () => void }[] = [];
  afterEach(() => {
    while (open.length) open.pop()!.close();
    vi.unstubAllGlobals();
  });

  it("sign-in on tab A updates tab B without reload (B re-reads the server session)", async () => {
    let server = { wallet: null as string | null, expiresAt: null as string | null };
    const a = tab(() => server);
    const b = tab(() => server);
    open.push(a, b);
    await a.observe();
    await b.observe();
    expect(b.wallet()).toBeNull();
    server = { wallet: CREATOR, expiresAt: new Date(NOW + 1_800_000).toISOString() };
    expect(b.qc.getQueryState(roomKeys.session())?.isInvalidated).toBe(false);
    a.sync.announce("signed-in");
    await tick();
    // The event only marks B's session stale; the wallet comes from B's own server read.
    expect(b.qc.getQueryState(roomKeys.session())?.isInvalidated).toBe(true);
    expect(b.wallet()).toBeNull();
    await b.qc.refetchQueries({ queryKey: roomKeys.session(), type: "all" });
    expect(b.received).toEqual(["signed-in"]);
    expect(b.wallet()).toBe(CREATOR);
    expect(a.received).toEqual([]); // the sender doesn't hear itself
  });

  it("sign-out on tab A signs tab B out", async () => {
    let server = { wallet: CREATOR as string | null, expiresAt: new Date(NOW + 1_800_000).toISOString() as string | null };
    const a = tab(() => server);
    const b = tab(() => server);
    open.push(a, b);
    await b.observe();
    expect(b.wallet()).toBe(CREATOR);
    server = { wallet: null, expiresAt: null };
    a.sync.announce("signed-out");
    await tick();
    expect(b.received).toEqual(["signed-out"]);
    expect(b.qc.getQueryState(roomKeys.session())?.isInvalidated).toBe(true);
    await b.qc.refetchQueries({ queryKey: roomKeys.session(), type: "all" });
    expect(b.wallet()).toBeNull();
  });

  it("storage-event fallback (no BroadcastChannel) works the same and leaves nothing stored", async () => {
    let server = { wallet: null as string | null, expiresAt: null as string | null };
    const bus = new EventTarget();
    const a = tab(() => server, "storage", bus);
    const b = tab(() => server, "storage", bus);
    open.push(a, b);
    await b.observe();
    server = { wallet: CREATOR, expiresAt: null };
    a.sync.announce("wallet-changed");
    await tick(5);
    expect(b.received).toEqual(["wallet-changed"]);
    expect(b.qc.getQueryState(roomKeys.session())?.isInvalidated).toBe(true);
    expect(a.received).toEqual([]);
    await b.qc.refetchQueries({ queryKey: roomKeys.session(), type: "all" });
    expect(b.wallet()).toBe(CREATOR);
    expect(a.stored.has(SESSION_SYNC_STORAGE_KEY)).toBe(false);
  });

  it("a forged event can't authenticate: it only causes a server re-read, which still says signed out", async () => {
    const b = tab(() => ({ wallet: null, expiresAt: null }));
    open.push(b);
    await b.observe();
    const forger = new BroadcastChannel(SESSION_SYNC_CHANNEL);
    forger.postMessage({ v: 1, type: "signed-in", id: "forged-0000000001" });
    forger.postMessage({ v: 1, type: "signed-in", id: "forged-0000000002", wallet: CREATOR, token: "x" }); // extra claims → dropped
    forger.postMessage({ v: 1, type: "grant-admin", id: "forged-0000000003" });
    forger.postMessage("not json");
    await tick();
    forger.close();
    expect(b.received).toEqual(["signed-in"]);
    await b.qc.refetchQueries({ queryKey: roomKeys.session(), type: "all" });
    expect(b.wallet()).toBeNull();
    expect(parseSyncMessage({ v: 1, type: "signed-in", id: "abcdefgh12", wallet: CREATOR })).toBeNull();
    expect(parseSyncMessage(JSON.stringify({ v: 1, type: "signed-out", id: "abcdefgh12" }))).toEqual({ v: 1, type: "signed-out", id: "abcdefgh12" });
  });

  it("messages carry only {v, type, id}; duplicates are delivered once and receivers never rebroadcast", async () => {
    const posted: unknown[] = [];
    const listeners: ((e: { data: unknown }) => void)[] = [];
    const fakeChannel = () => {
      const ch = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        postMessage: (m: unknown) => {
          posted.push(m);
          for (const l of listeners) if (l !== ch.onmessage) l({ data: m });
        },
        close: () => undefined,
      };
      queueMicrotask(() => ch.onmessage && listeners.push(ch.onmessage));
      return ch;
    };
    const a = createSessionSync({ createChannel: fakeChannel, randomId: () => "fixed-id-00000001" });
    const b = createSessionSync({ createChannel: fakeChannel });
    await tick(1);
    const got: string[] = [];
    b.subscribe((t) => got.push(t));
    a.announce("signed-in");
    a.announce("signed-in"); // same id (fixed) → deduped at B
    expect(posted).toHaveLength(2);
    for (const m of posted) expect(Object.keys(m as object).sort()).toEqual(["id", "type", "v"]);
    expect(got).toEqual(["signed-in"]);
    expect(posted).toHaveLength(2); // B didn't post anything back
    a.close();
    b.close();
  });

  it("sign-in labels and expiry timer (one timer, no polling)", () => {
    expect(signInEvent(null, CREATOR)).toBe("signed-in");
    expect(signInEvent(CREATOR, CREATOR)).toBe("signed-in");
    expect(signInEvent("2hRywEUiyMvZd2gp9UD6nm5wqzrcwRo3qE7xyiCnDkKZ", CREATOR)).toBe("wallet-changed");
    expect(expiryDelayMs(new Date(NOW + 60_000).toISOString(), NOW)).toBe(61_000);
    expect(expiryDelayMs(new Date(NOW - 60_000).toISOString(), NOW)).toBe(0);
    expect(expiryDelayMs(null, NOW)).toBeNull();
    expect(expiryDelayMs("garbage", NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------- 4. wallet menu sign-out

describe("wallet menu sign-out", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("'Sign out' only appears while signed in; Disconnect is separate", () => {
    expect(walletMenuItems(null)).toEqual(["copy", "solscan", "disconnect"]);
    expect(walletMenuItems(CREATOR)).toEqual(["copy", "solscan", "sign-out", "disconnect"]);
  });

  it("uses the existing logout (DELETE session, same-origin), refreshes this tab and tells other tabs; no wallet call", async () => {
    vi.stubGlobal("window", { localStorage: { setItem: () => undefined, removeItem: () => undefined }, addEventListener: () => undefined, removeEventListener: () => undefined });
    const calls: { url: string; method: string; credentials?: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", credentials: init.credentials, body: init.body });
      return new Response(JSON.stringify({ wallet: null }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const otherTab = new BroadcastChannel(SESSION_SYNC_CHANNEL);
    const heard: unknown[] = [];
    otherTab.onmessage = (e) => heard.push(e.data);
    const invalidated: unknown[] = [];
    const res = await signOutAndRefresh({ invalidateQueries: async (f) => void invalidated.push(f.queryKey) });
    await tick();
    otherTab.close();
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual([{ url: "/api/rooms/auth/session", method: "DELETE", credentials: "same-origin", body: undefined }]);
    expect(invalidated).toEqual([roomKeys.session()]);
    expect(heard).toHaveLength(1);
    expect(parseSyncMessage(heard[0])?.type).toBe("signed-out");
  });

  it("failed sign-out still re-reads the session and doesn't announce", async () => {
    vi.stubGlobal("window", { localStorage: null, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "CROSS_ORIGIN" }), { status: 403 }));
    const otherTab = new BroadcastChannel(SESSION_SYNC_CHANNEL);
    const heard: unknown[] = [];
    otherTab.onmessage = (e) => heard.push(e.data);
    const invalidated: unknown[] = [];
    const res = await signOutAndRefresh({ invalidateQueries: async (f) => void invalidated.push(f.queryKey) });
    await tick();
    otherTab.close();
    expect(res).toEqual({ ok: false });
    expect(invalidated).toEqual([roomKeys.session()]);
    expect(heard).toEqual([]);
  });

  it("re-sign-in after sign-out needs a fresh challenge + signature (announced only after the server verifies)", async () => {
    vi.stubGlobal("window", { localStorage: null, addEventListener: () => undefined, removeEventListener: () => undefined });
    const seq: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seq.push(url);
      if (url.endsWith("/challenge")) return new Response(JSON.stringify({ nonce: "n".repeat(32), message: "Sign in", wallet: CREATOR }), { status: 200 });
      return new Response(JSON.stringify({ code: "BAD_SIGNATURE", detail: "Signature check failed." }), { status: 401 });
    });
    const otherTab = new BroadcastChannel(SESSION_SYNC_CHANNEL);
    const heard: unknown[] = [];
    otherTab.onmessage = (e) => heard.push(e.data);
    const sign = vi.fn(async () => new Uint8Array(64));
    await expect(verifyWalletOwnership(CREATOR, sign, null)).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
    await tick();
    otherTab.close();
    expect(sign).toHaveBeenCalledTimes(1);
    expect(seq).toEqual(["/api/rooms/auth/challenge", "/api/rooms/auth/verify"]);
    expect(heard).toEqual([]); // a failed verify announces nothing
  });
});
