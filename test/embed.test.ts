/**
 * Phase 4 — embeddable prediction room widgets (/embed/rooms/:slug) and the
 * creator-only embed generator API. Runs on the SQLite adapter with routes
 * imported directly. Market data is injected into the bounded snapshot cache
 * (never live Panta / RPC here). Wallet keys are generated per run.
 */
import { __setForecastDepsForTests } from "@/lib/forecasts/deps";
import type { ForecastWindow } from "@/lib/forecasts/window";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Market } from "@/lib/panta/domain";
import type { ChainEventRead } from "@/lib/panta/chain-event-server";
import type { FinalizationRecord } from "@/lib/arena/types";
import { isListedRoom, publicScore } from "@/lib/arena/public";
import { buildEmbedModel, freshnessLabel, type SnapshotLike } from "@/lib/embed/model";
import { renderEmbed } from "@/lib/embed/html";
import {
  SNAPSHOT_FRESH_MS,
  SNAPSHOT_MAX_STALE_MS,
  __resetSnapshotCacheForTests,
  getMarketSnapshot,
  type SnapshotSources,
} from "@/lib/embed/market-snapshot";
import { DEFAULT_EMBED_OPTIONS, embedHeight, embedQuery, parseEmbedOptions } from "@/lib/embed/options";
import { DEV_FALLBACK_ORIGIN, PRODUCTION_FALLBACK_ORIGIN, appOrigin, validateOrigin } from "@/lib/embed/origin";
import { embedPath, embedUrl, escapeHtml, iframeSnippet, roomUrl } from "@/lib/embed/snippet";
import { EMBED_CSS, EMBED_CSS_HASH } from "@/lib/embed/styles";
import { EMBED_CACHE_CONTROL, EMBED_RATE_LIMIT_PER_MIN } from "@/lib/embed/respond";
import { buildEmbedCsp, embedSecurityHeaders, securityHeaders } from "@/lib/security-headers";
import { emptyAggregate, type ForecastAggregate } from "@/lib/forecasts/domain";
import { issueSession, SESSION_COOKIE, sessionSecret } from "@/lib/rooms/auth";
import { newRoomId } from "@/lib/rooms/service";
import { SqliteRoomRepository } from "@/lib/rooms/store/sqlite";
import { __setRoomRepositoryForTests, roomRepository } from "@/lib/rooms/store";
import type { RoomRepository } from "@/lib/rooms/store/types";
import type { RoomRecord } from "@/lib/rooms/domain";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------- fixtures

const MARKET = "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn";
const NOW_SEC = Math.floor(Date.now() / 1000);

function newWallet(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  return bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url"));
}

const openMarket = (over: Partial<Market> = {}): Market => ({
  marketId: MARKET,
  title: "Haaland 8+ points, GW6",
  category: "sports",
  phase: "primary",
  status: "active",
  endTime: NOW_SEC + 30 * 86_400,
  primaryPhaseEndTime: NOW_SEC + 10 * 86_400,
  yesPrice: "0.499",
  noPrice: "0.501",
  resolved: false,
  ...over,
});

const failedChain = (): ChainEventRead => ({ status: "failed", error: "test: no chain", fetchedAt: Date.now() });
function sources(detail: Market | null, calls = { chain: 0, detail: 0 }): SnapshotSources {
  return {
    readChain: async () => {
      calls.chain += 1;
      return failedChain();
    },
    readDetail: async () => {
      calls.detail += 1;
      return detail ? { status: "ok", detail } : { status: "failed", detail: null };
    },
    catalogRow: () => null,
  };
}

const snap = (over: Partial<SnapshotLike> = {}): SnapshotLike => ({
  status: "fresh",
  market: openMarket(),
  ageMs: 0,
  sourcesAgreeResolved: null,
  detailOk: true,
  ...over,
});

const agg = (bps: number[]): ForecastAggregate => {
  const a = emptyAggregate();
  for (const b of bps) {
    a.participants += 1;
    a.sumBps += b;
    a.buckets[Math.min(9, Math.floor(b / 1000))] += 1;
  }
  return a;
};

const ORIGIN = "https://briefcommand.example";
const model = (over: Partial<Parameters<typeof buildEmbedModel>[0]> = {}) =>
  buildEmbedModel({
    room: { slug: "haaland-room", title: "Haaland room" },
    origin: ORIGIN,
    aggregate: agg([6150]),
    finalization: null,
    snapshot: snap(),
    nowMs: Date.now(),
    ...over,
  });

const scored = (outcome: "yes" | "no", slot = 455_123_456) =>
  ({ status: "scored", outcome, provenance: { chain: { slot } } }) as unknown as FinalizationRecord;
const blocked = () => ({ status: "blocked", outcome: null }) as unknown as FinalizationRecord;

// ---------------------------------------------------------------- repo + routes

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  __setRoomRepositoryForTests(undefined);
});

let seq = 0;
async function seedRoom(repo: RoomRepository, over: Partial<RoomRecord> = {}): Promise<RoomRecord> {
  const roomId = newRoomId();
  const slug = over.slug ?? `embed-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await repo.createRoom(
    {
      roomId,
      slug,
      title: over.title ?? `Room ${seq}`,
      description: "",
      creatorWallet: over.creatorWallet ?? newWallet(),
      marketId: over.marketId ?? MARKET,
      visibility: over.visibility ?? "public",
      status: over.status ?? "active",
      createdAt: Date.now() - 86_400_000,
    },
    { key: `room-key-${roomId}`.slice(0, 40), fingerprint: "room" },
  );
  return (await repo.getRoomById(roomId))!;
}

async function forecast(repo: RoomRepository, room: RoomRecord, wallet: string, bps: number) {
  const at = Date.now() - 3_600_000;
  const cur = await repo.getCurrentForecast(room.roomId, wallet);
  await repo.noteParticipation({ wallet, roomId: room.roomId, marketId: room.marketId, at });
  return repo.submitForecast(
    { roomId: room.roomId, wallet, probabilityBps: bps, reasoning: "", expectedRevision: cur?.revision ?? 0, now: at, newForecastId: `fc_${String(++seq).padStart(24, "0")}` },
    { key: `idem-${String(++seq).padStart(14, "0")}`, fingerprint: `fp-${seq}` },
  );
}

type Handler = (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
let embedGET: Handler;
let embedRestGET: (req: NextRequest) => Promise<Response>;
let creatorGET: Handler;
let ipSeq = 0;
function req(url: string, init: { cookie?: string; ip?: string; host?: string } = {}) {
  const headers: Record<string, string> = { "x-vercel-forwarded-for": init.ip ?? `10.${++ipSeq % 250}.${Math.floor(ipSeq / 250) % 250}.1` };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.host) {
    headers.host = init.host;
    headers["x-forwarded-host"] = init.host;
  }
  return new NextRequest(`http://localhost${url}`, { headers });
}
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const embed = (slug: string, q = "", init: Parameters<typeof req>[1] = {}) => embedGET(req(`/embed/rooms/${slug}${q ? `?${q}` : ""}`, init), ctx(slug));
/** A real, registered session (the server checks its store record on every request). */
const cookieFor = async (wallet: string) => `${SESSION_COOKIE}=${(await issueSession(roomRepository(), wallet, Date.now(), sessionSecret()!)).value}`;

let repo: RoomRepository;
const repoCalls: string[] = [];

beforeAll(async () => {
  embedGET = (await import("@/app/embed/rooms/[slug]/route")).GET as Handler;
  embedRestGET = (await import("@/app/embed/[...rest]/route")).GET as (req: NextRequest) => Promise<Response>;
  creatorGET = (await import("@/app/api/rooms/[slug]/embed/route")).GET as Handler;
});

beforeEach(async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "embed-test-"));
  tmpDirs.push(d);
  const real = new SqliteRoomRepository(path.join(d, "rooms.sqlite"));
  repoCalls.length = 0;
  // Record every repository method the routes call (read-only expectations).
  repo = new Proxy(real, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        repoCalls.push(String(p));
        return (v as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  }) as RoomRepository;
  __setRoomRepositoryForTests(repo);
  __resetSnapshotCacheForTests();
  // Market data for MARKET comes from the injected snapshot cache only.
  await getMarketSnapshot(MARKET, { src: sources(openMarket()) });
  // The shared forecast window (same function the room panel and Studio use), pinned: no network in tests.
  __setForecastDepsForTests({ checkWindow: async (_m, nowMs) => embedWindowNow(nowMs) });
});
afterEach(() => {
  __resetSnapshotCacheForTests();
  __setForecastDepsForTests({});
});

/** What the shared window check answers in the route tests (tests override it per case). */
const embedWindowNow: (nowMs: number) => ForecastWindow = (nowMs) => ({ open: true, cutoffAt: nowMs + 3_600_000, lifecycle: "open", checkedAt: nowMs });

// ---------------------------------------------------------------- 1–4 public render & denial

describe("embed route: visibility", () => {
  it("1. public render: title, question, mean, participants, CTA, attribution, safe external links", async () => {
    const room = await seedRoom(repo, { title: "Haaland GW6 room" });
    await forecast(repo, room, newWallet(), 6150);
    const res = await embed(room.slug);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("Haaland GW6 room");
    expect(html).toContain("Haaland 8+ points, GW6");
    expect(html).toContain("61.5%");
    expect(html).toContain("mean of 1 forecaster");
    expect(html).toContain("Add your forecast on Brief Command");
    expect(html).toContain("Brief Command</a> · Powered by Panta");
    // Widget links carry ?ref=embed (Creator Studio click-through attribution); the canonical link stays clean.
    expect(html).toContain(`href="${DEV_FALLBACK_ORIGIN}/rooms/${room.slug}?ref=embed" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain(`<link rel="canonical" href="${DEV_FALLBACK_ORIGIN}/rooms/${room.slug}">`);
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).not.toMatch(/<script|<form|<input|<[^>]*\son[a-z]+=/i);
    const links = html.match(/<a [^>]*>/g)!;
    for (const a of links) expect(a).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("unlisted rooms are embeddable by link (same as /rooms/:slug), still noindex", async () => {
    const room = await seedRoom(repo, { visibility: "unlisted", title: "Link-only room" });
    const res = await embed(room.slug);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Link-only room");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("2. private/missing denial: a room that doesn't exist → 404 'Room not available'", async () => {
    const res = await embed("does-not-exist-room");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Room not available");
  });

  it("3. disabled (archived) room → the SAME 404 body and headers as a missing room", async () => {
    const room = await seedRoom(repo, { status: "archived", title: "Secret archived title" });
    const a = await embed(room.slug, "theme=light");
    const b = await embed("zz-missing-room", "theme=light");
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    const [ta, tb] = [await a.text(), await b.text()];
    expect(ta).toBe(tb);
    expect(ta).not.toContain("Secret archived title");
    expect([...a.headers.entries()].sort()).toEqual([...b.headers.entries()].sort());
  });

  it("4. invalid slugs (bad chars, too long, bad encoding, traversal) → identical 404, no repository read", async () => {
    const ref = await (await embed("zz-missing-room")).text();
    repoCalls.length = 0;
    for (const s of ["%3Cscript%3E", "a".repeat(200), "%E0%A4%A", "..%2F..%2Fapi", "UPPER_case!", "x"]) {
      const res = await embed(s);
      expect(res.status, s).toBe(404);
      expect(await res.text()).toBe(ref);
    }
    expect(repoCalls.filter((c) => c === "getRoomBySlug").length).toBeLessThanOrEqual(1); // only "x"-style valid-shaped slugs may be looked up
    const rest = await embedRestGET(req("/embed/whatever/else"));
    expect(rest.status).toBe(404);
    expect(await rest.text()).toBe(ref);
  });
});

// ---------------------------------------------------------------- 5–7 options

describe("embed options", () => {
  it("5. allowlist: exact values only; invalid → defaults; unknown keys ignored; fixed query order", () => {
    const p = (q: string) => parseEmbedOptions(new URLSearchParams(q));
    expect(p("")).toEqual(DEFAULT_EMBED_OPTIONS);
    expect(DEFAULT_EMBED_OPTIONS).toEqual({ theme: "dark", layout: "standard", dist: true, market: true });
    expect(p("theme=light&layout=compact&dist=0&market=0")).toEqual({ theme: "light", layout: "compact", dist: false, market: false });
    expect(p("theme=%3Cscript%3E&layout=huge&dist=maybe&market=2&evil=1")).toEqual(DEFAULT_EMBED_OPTIONS);
    expect(p("theme=LIGHT&layout=Compact&dist=true&market=false")).toEqual(DEFAULT_EMBED_OPTIONS);
    expect(p("theme=light&theme=dark").theme).toBe("light");
    expect(embedQuery({ theme: "light", layout: "compact", dist: false, market: true })).toBe("theme=light&layout=compact&dist=0&market=1");
    expect(embedHeight(DEFAULT_EMBED_OPTIONS)).toBe(540);
    expect(embedHeight({ ...DEFAULT_EMBED_OPTIONS, layout: "compact" })).toBe(340);
  });

  it("6. themes: body class from the allowlist only; both themes defined in the CSS", async () => {
    const room = await seedRoom(repo);
    expect(await (await embed(room.slug, "theme=light")).text()).toContain('<body class="t-light l-standard">');
    expect(await (await embed(room.slug, "theme=dark")).text()).toContain('<body class="t-dark l-standard">');
    expect(await (await embed(room.slug, "theme=%22onload%3D")).text()).toContain('<body class="t-dark l-standard">');
    expect(EMBED_CSS).toContain(".t-dark");
    expect(EMBED_CSS).toContain(".t-light");
  });

  it("7. layouts: compact drops question, distribution, resolution text and note; dist/market toggles honoured", () => {
    const m = model({ aggregate: agg([2000, 6000, 8500]) });
    const std = renderEmbed(m, DEFAULT_EMBED_OPTIONS);
    expect(std).toContain('class="dist"');
    expect(std).toContain("Market:</b>");
    expect(std).toContain('class="note"');
    const compact = renderEmbed(m, { ...DEFAULT_EMBED_OPTIONS, layout: "compact" });
    expect(compact).toContain('l-compact');
    expect(compact).not.toContain('class="dist"');
    expect(compact).not.toContain("Market:</b>");
    expect(compact).not.toContain('class="note"');
    expect(renderEmbed(m, { ...DEFAULT_EMBED_OPTIONS, dist: false })).not.toContain('class="dist"');
    const noMarket = renderEmbed(m, { ...DEFAULT_EMBED_OPTIONS, market: false });
    expect(noMarket).not.toContain('aria-label="Panta market"');
    expect(noMarket).not.toContain("Market:</b>");
  });
});

// ---------------------------------------------------------------- 8–12 content

describe("embed content", () => {
  it("8. aggregate correctness: persisted aggregate → mean (half-up to 0.01%), participants, buckets; revisions count once", async () => {
    const room = await seedRoom(repo);
    const w = [newWallet(), newWallet(), newWallet()];
    await forecast(repo, room, w[0], 2000);
    await forecast(repo, room, w[1], 5000);
    await forecast(repo, room, w[2], 8050);
    await forecast(repo, room, w[2], 8051); // revision replaces, doesn't add
    const html = await (await embed(room.slug)).text();
    // (2000+5000+8051)/3 = 5017 bps (half-up) → shown at 0.1% precision
    expect(html).toContain("50.2%<small>mean of 3 forecasters</small>");
    expect(html).toContain("Distribution of 3 forecasts by YES probability. 0–10%: 0, 10–20%: 0, 20–30%: 1, 30–40%: 0, 40–50%: 0, 50–60%: 1, 60–70%: 0, 70–80%: 0, 80–90%: 1, 90–100%: 0");
  });

  it("9. zero-forecast room: no fake number, honest copy, CTA still offered while open", async () => {
    const room = await seedRoom(repo);
    const html = await (await embed(room.slug)).text();
    expect(html).toContain('<p class="big">—</p>');
    expect(html).toContain("No forecasts yet. Be the first.");
    expect(html).toContain("Add your forecast on Brief Command");
    expect(html).not.toContain('class="dist"');
    const closed = renderEmbed(model({ aggregate: emptyAggregate(), snapshot: snap({ market: openMarket({ primaryPhaseEndTime: NOW_SEC - 60 }) }) }), DEFAULT_EMBED_OPTIONS);
    expect(closed).toContain("No community forecasts were made.");
    expect(closed).toContain("Open the room on Brief Command");
  });

  it("10. resolved: arena 'scored' → verified with slot; blocked → no outcome; one-sided → awaiting verification, side hidden", () => {
    const resolvedMarket = openMarket({ phase: "resolved", status: "resolved", resolved: true, outcome: "yes" });
    const v = renderEmbed(model({ finalization: scored("no"), snapshot: snap({ market: resolvedMarket }) }), DEFAULT_EMBED_OPTIONS);
    expect(v).toContain("Verified: NO"); // arena record wins over a market record that says yes
    expect(v).toContain("(slot 455123456)");
    expect(v).toContain("Final community forecast");
    expect(v).toContain("Market resolved");
    expect(v).not.toContain("implies YES");

    const b = renderEmbed(model({ finalization: blocked(), snapshot: snap({ market: resolvedMarket }) }), DEFAULT_EMBED_OPTIONS);
    expect(b).toContain("Resolution sources disagree");
    expect(b).not.toMatch(/Verified: |Resolved <strong>/);

    const one = renderEmbed(model({ snapshot: snap({ market: resolvedMarket }) }), DEFAULT_EMBED_OPTIONS);
    expect(one).toContain("Awaiting verification");
    expect(one).not.toMatch(/Verified: |Resolved <strong>(YES|NO)/);

    const agree = model({ snapshot: snap({ market: resolvedMarket, sourcesAgreeResolved: { outcome: "yes", slot: 7 } }) });
    expect(agree.resolution).toEqual({ kind: "verified", outcome: "yes", via: "sources", slot: 7 });
    expect(agree.forecastingOpen).toBe(false);
  });

  it("11. missing market data: community still renders, market section says unavailable, no price, no lifecycle claim", async () => {
    __resetSnapshotCacheForTests();
    const s = await getMarketSnapshot(MARKET, { src: sources(null), waitMs: 50 });
    expect(s.status).toBe("unavailable");
    const html = renderEmbed(model({ snapshot: s }), DEFAULT_EMBED_OPTIONS);
    expect(html).toContain("61.5%");
    expect(html).toContain("Panta price unavailable");
    expect(html).toContain("Panta market data is unavailable right now · community data is current");
    expect(html).toContain("Market status unavailable");
    expect(html).not.toContain("Add your forecast"); // open-ness can't be claimed without market data
  });

  it("12. stale market data: served from the bounded cache with an age label, refreshed in the background, dropped after the max", async () => {
    __resetSnapshotCacheForTests();
    let t = 1_000_000;
    const now = () => t;
    const calls = { chain: 0, detail: 0 };
    const first = await getMarketSnapshot(MARKET, { src: sources(openMarket(), calls), now });
    expect(first.status).toBe("fresh");
    t += SNAPSHOT_FRESH_MS + 60_000;
    const stale = await getMarketSnapshot(MARKET, { src: sources(null, calls), now }); // refresh fails
    expect(stale.status).toBe("stale");
    expect(freshnessLabel(stale)).toMatch(/^Panta data from \d+ min ago · refreshing$/);
    expect(renderEmbed(model({ snapshot: stale }), DEFAULT_EMBED_OPTIONS)).toContain("implies YES <strong>49.9%</strong>");
    await new Promise((r) => setTimeout(r, 5));
    t += SNAPSHOT_MAX_STALE_MS;
    const gone = await getMarketSnapshot(MARKET, { src: sources(null, calls), now, waitMs: 20 });
    expect(gone.status).toBe("unavailable");
    expect(calls.detail).toBeGreaterThanOrEqual(3);
    expect(freshnessLabel({ ...stale, status: "fresh", detailOk: false, ageMs: 2000 })).toMatch(/On-chain market data checked just now/);
  });

  it("primary price shows an implied probability; secondary shows USDC prices labelled 'not probabilities'", () => {
    expect(renderEmbed(model(), DEFAULT_EMBED_OPTIONS)).toContain("Panta primary price implies YES <strong>49.9%</strong>");
    const sec = model({ snapshot: snap({ market: openMarket({ phase: "secondary", status: "active", primaryPhaseEndTime: NOW_SEC - 86_400, yesPrice: "0.62", noPrice: "0.41" }) }) });
    const html = renderEmbed(sec, DEFAULT_EMBED_OPTIONS);
    if (sec.market.price.mode === "secondary") {
      expect(html).toContain("(prices, not probabilities)");
      expect(html).not.toContain("implies YES");
    } else {
      expect(sec.market.price.mode).toBe("none"); // no observed secondary prices: nothing invented
    }
    expect(sec.forecastingOpen).toBe(false);
  });
});

// ---------------------------------------------------------------- 13–16 creator tools, snippet, origin

describe("creator embed API + snippet", () => {
  it("13. creator controls: the room's creator (server-verified session) gets the generator config", async () => {
    const creator = newWallet();
    const room = await seedRoom(repo, { creatorWallet: creator, title: "Mine" });
    const res = await creatorGET(req(`/api/rooms/${room.slug}/embed`, { cookie: await cookieFor(creator) }), ctx(room.slug));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      slug: room.slug,
      title: "Mine",
      origin: DEV_FALLBACK_ORIGIN,
      roomUrl: `${DEV_FALLBACK_ORIGIN}/rooms/${room.slug}`,
      embedPath: `/embed/rooms/${room.slug}`,
      defaults: DEFAULT_EMBED_OPTIONS,
    });
    expect(JSON.stringify(body)).not.toContain(creator); // no wallet echo needed
  });

  it("14. non-creator denial: no session 401, another wallet 403, forged cookie 401, archived/missing 404", async () => {
    const room = await seedRoom(repo);
    expect((await creatorGET(req(`/api/rooms/${room.slug}/embed`), ctx(room.slug))).status).toBe(401);
    expect((await creatorGET(req(`/api/rooms/${room.slug}/embed`, { cookie: await cookieFor(newWallet()) }), ctx(room.slug))).status).toBe(403);
    const forged = `${SESSION_COOKIE}=v1.${Buffer.from(JSON.stringify({ v: 1, w: room.creatorWallet, iat: 0, exp: 9e15 })).toString("base64url")}.AAAA`;
    expect((await creatorGET(req(`/api/rooms/${room.slug}/embed`, { cookie: forged }), ctx(room.slug))).status).toBe(401);
    const arch = await seedRoom(repo, { status: "archived" });
    expect((await creatorGET(req(`/api/rooms/${arch.slug}/embed`, { cookie: await cookieFor(arch.creatorWallet) }), ctx(arch.slug))).status).toBe(404);
    expect((await creatorGET(req(`/api/rooms/nope-nope/embed`, { cookie: await cookieFor(room.creatorWallet) }), ctx("nope-nope"))).status).toBe(404);
  });

  it("15. safe snippet: escaped attributes, encoded slug, sandboxed, lazy, no script", () => {
    const s = iframeSnippet("https://briefcommand.vercel.app", "haaland-room", `"><script>alert(1)</script> & 'x' \`y\``, DEFAULT_EMBED_OPTIONS);
    expect(s).not.toContain("<script>");
    expect(s).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;x&#39; &#96;y&#96;");
    expect(s).toContain('src="https://briefcommand.vercel.app/embed/rooms/haaland-room?theme=dark&amp;layout=standard&amp;dist=1&amp;market=1"');
    expect(s).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox"');
    expect(s).toContain('loading="lazy"');
    expect(s).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(s).toContain('height="540"');
    expect(s.match(/<iframe /g)!.length).toBe(1);
    expect(embedPath("a/b?c")).toBe("/embed/rooms/a%2Fb%3Fc");
    expect(roomUrl("https://x.example", "a b")).toBe("https://x.example/rooms/a%20b");
    expect(embedUrl("https://x.example", "r", { theme: "light", layout: "compact", dist: false, market: false })).toBe("https://x.example/embed/rooms/r?theme=light&layout=compact&dist=0&market=0");
    expect(escapeHtml(`<>&"'\``)).toBe("&lt;&gt;&amp;&quot;&#39;&#96;");
  });

  it("16. canonical origin: configured env only (never Host); prod fallback; unsafe values rejected", async () => {
    expect(appOrigin({ NODE_ENV: "development" })).toBe(DEV_FALLBACK_ORIGIN);
    expect(appOrigin({ NODE_ENV: "production" })).toBe(PRODUCTION_FALLBACK_ORIGIN);
    expect(PRODUCTION_FALLBACK_ORIGIN).toBe("https://briefcommand.vercel.app");
    expect(appOrigin({ NODE_ENV: "production", APP_ORIGIN: "https://brief.example", NEXT_PUBLIC_APP_ORIGIN: "https://other.example" })).toBe("https://brief.example");
    expect(appOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_ORIGIN: "https://other.example/" })).toBe("https://other.example");
    expect(appOrigin({ NODE_ENV: "production", APP_ORIGIN: "http://brief.example" })).toBe(PRODUCTION_FALLBACK_ORIGIN);
    expect(appOrigin({ NODE_ENV: "production", APP_ORIGIN: "http://localhost:3100" })).toBe(PRODUCTION_FALLBACK_ORIGIN);
    expect(appOrigin({ NODE_ENV: "development", APP_ORIGIN: "http://localhost:3999" })).toBe("http://localhost:3999");
    for (const bad of ["https://a.example/path", "https://a.example/?q=1", "https://a.example/#h", "https://u:p@a.example", "javascript:alert(1)", "//evil.example", "ftp://a.example"]) {
      expect(validateOrigin(bad, true), bad).toBeNull();
    }
    // Host / X-Forwarded-Host are ignored by the embed and the creator API.
    const creator = newWallet();
    const room = await seedRoom(repo, { creatorWallet: creator });
    const html = await (await embed(room.slug, "", { host: "evil.example" })).text();
    expect(html).not.toContain("evil.example");
    const api = (await (await creatorGET(req(`/api/rooms/${room.slug}/embed`, { cookie: await cookieFor(creator), host: "evil.example" }), ctx(room.slug))).json()) as { origin: string };
    expect(api.origin).toBe(DEV_FALLBACK_ORIGIN);
  });
});

// ---------------------------------------------------------------- 17–20 security

describe("embed security", () => {
  it("17. injection resistance: hostile room title / market title are escaped; hostile query never reflected", async () => {
    const room = await seedRoom(repo, { title: `</title><script>alert(1)</script><img src=x onerror=alert(2)>` });
    const res = await embed(room.slug, "theme=%22%3E%3Cscript%3Ealert(3)%3C/script%3E&layout=%3Csvg%20onload%3D1%3E&x=%3Cscript%3E");
    const html = await res.text();
    expect(html).not.toMatch(/<script|<img|<[^>]*\son[a-z]+=/i);
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt;");
    expect(html).not.toContain("alert(3)");
    const m = renderEmbed(model({ snapshot: snap({ market: openMarket({ title: `<b onmouseover=x>Q</b>` }) }) }), DEFAULT_EMBED_OPTIONS);
    expect(m).not.toContain("<b onmouseover");
  });

  it("18. framing headers on /embed/**: embed CSP (frame-ancestors https:, default-src 'none', sandbox, hashed style), no XFO, no cookies, noindex", async () => {
    const room = await seedRoom(repo);
    for (const res of [await embed(room.slug), await embed("zz-missing-room"), await embedRestGET(req("/embed/x/y"))]) {
      const csp = res.headers.get("content-security-policy")!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain(`style-src '${EMBED_CSS_HASH}'`);
      expect(csp).toContain("frame-ancestors https:");
      expect(csp).not.toContain("frame-ancestors 'none'");
      expect(csp).not.toMatch(/script-src|unsafe-inline|unsafe-eval/);
      expect(csp).toContain("sandbox allow-popups allow-popups-to-escape-sandbox");
      expect(csp).toContain("form-action 'none'");
      expect(res.headers.get("x-frame-options")).toBeNull();
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("cache-control")).toBe(EMBED_CACHE_CONTROL);
    }
    expect(EMBED_CSS_HASH).toBe(`sha256-${createHash("sha256").update(EMBED_CSS, "utf8").digest("base64")}`);
    // http://localhost ancestors only in development
    expect(buildEmbedCsp({ dev: true, styleHash: "sha256-x" })).toContain("frame-ancestors https: http://localhost:* http://127.0.0.1:*");
    expect(buildEmbedCsp({ dev: false, styleHash: "sha256-x" })).toMatch(/frame-ancestors https:;/);
    expect(embedSecurityHeaders("sha256-x", { NODE_ENV: "production" })["Content-Security-Policy"]).not.toContain("localhost");
  });

  it("18b. the embed handler never reads cookies or the session", () => {
    const files = [
      "src/app/embed/rooms/[slug]/route.ts",
      "src/app/embed/[...rest]/route.ts",
      ...readdirSync("src/lib/embed").map((f) => `src/lib/embed/${f}`),
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/cookies\(|currentSession|req\.cookies|getSession/);
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it("19. every other route keeps frame-ancestors 'none' + X-Frame-Options DENY (next.config excludes only /embed/**)", async () => {
    const cfg = (await import("../next.config")).default;
    const rules = await cfg.headers!();
    expect(rules).toHaveLength(1);
    const re = new RegExp(`^${rules[0].source}$`);
    for (const p of ["/", "/desk", "/create", "/execute", "/book", "/rooms", "/rooms/x", "/arena", "/api/rooms", "/api/arena", "/embed", "/embedx", "/embeds/x", "/api/embed/rooms/x", "/rooms/x/embed"]) {
      expect(re.test(p), p).toBe(true);
    }
    for (const p of ["/embed/rooms/x", "/embed/whatever"]) expect(re.test(p), p).toBe(false);
    const h = rules[0].headers;
    expect(h.find((x: { key: string }) => x.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(h.find((x: { key: string }) => x.key === "Content-Security-Policy")?.value).toContain("frame-ancestors 'none'");
    const prod = securityHeaders({ NODE_ENV: "production" }).find((x) => x.key === "Content-Security-Policy")!.value;
    expect(prod).toContain("frame-ancestors 'none'");
    // App routes under src/app/embed are only route handlers (they send their own headers).
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    expect(walk("src/app/embed").map((f) => path.basename(f))).toEqual(expect.arrayContaining(["route.ts"]));
    expect(walk("src/app/embed").every((f) => path.basename(f) === "route.ts")).toBe(true);
  });

  it("20. public read rate limit: per-IP budget then 429 (no-store, Retry-After, embed headers)", async () => {
    const ip = "198.18.0.77";
    let last: Response | null = null;
    for (let i = 0; i < EMBED_RATE_LIMIT_PER_MIN; i++) {
      last = await embed("zz-missing-room", "", { ip });
      expect(last.status).toBe(404);
    }
    const res = await embed("zz-missing-room", "", { ip });
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(await res.text()).toContain("Too many requests");
    expect((await embed("zz-missing-room", "", { ip: "198.18.0.78" })).status).toBe(404); // other visitors unaffected
  });
});

// ---------------------------------------------------------------- 21–23 regressions + performance

describe("embed performance + regressions", () => {
  it("9-perf. the embed reads persisted aggregates and the finalization record only; never finalizes, writes or gathers evidence", async () => {
    const room = await seedRoom(repo);
    await forecast(repo, room, newWallet(), 4000);
    repoCalls.length = 0;
    expect((await embed(room.slug)).status).toBe(200);
    expect([...new Set(repoCalls)].sort()).toEqual(["getFinalization", "getForecastAggregate", "getRoomBySlug"]);
    const routeSrc = readFileSync("src/app/embed/rooms/[slug]/route.ts", "utf8");
    expect(routeSrc).not.toMatch(/from\s+["'][^"']*(finalize|evidence|arena\/deps)[^"']*["']/);
    expect(routeSrc).not.toMatch(/\bfinalize[A-Z]\w*\(|gatherEvidence\(/);
  });

  it("21. room regression: archived rooms disappear from embeds while /api/rooms semantics stay (active public listed)", async () => {
    const pub = await seedRoom(repo);
    await seedRoom(repo, { visibility: "unlisted" });
    await seedRoom(repo, { status: "archived" });
    const listed = await repo.listPublicRooms({ limit: 10 });
    expect(listed.map((r) => r.slug)).toEqual([pub.slug]);
  });

  it("22. forecast regression: the embed's numbers equal the forecast service's consensus for the same aggregate", async () => {
    const room = await seedRoom(repo);
    for (const b of [1000, 3333, 9999]) await forecast(repo, room, newWallet(), b);
    const a = await repo.getForecastAggregate(room.roomId);
    expect(a.participants).toBe(3);
    const html = await (await embed(room.slug)).text();
    expect(html).toContain(`${Number((Math.round(a.sumBps / 3) / 100).toFixed(1))}%`);
    expect(html).toContain("mean of 3 forecasters");
  });

  it("23. arena regression: rooms are listed only when public AND active (archived rooms are anonymised like unlisted ones)", () => {
    expect(isListedRoom({ visibility: "public", status: "active" })).toBe(true);
    expect(isListedRoom({ visibility: "unlisted", status: "active" })).toBe(false);
    expect(isListedRoom({ visibility: "public", status: "archived" })).toBe(false);
    expect(isListedRoom(null)).toBe(false);
    const score = { roomId: "r1", marketId: MARKET, brierE8: 4_000_000, displayScoreC: 9600, forecastRevision: 1, forecastProbabilityBps: 8000, resolvedOutcome: "yes", forecastSubmittedAt: 1, finalizedAt: 2 } as unknown as Parameters<typeof publicScore>[0];
    const shown = publicScore(score, { slug: "s", title: "T", visibility: "public", status: "active" }, null);
    const hidden = publicScore(score, { slug: "s", title: "T", visibility: "public", status: "archived" }, null);
    expect([shown.roomSlug, shown.roomTitle]).toEqual(["s", "T"]);
    expect([hidden.roomSlug, hidden.roomTitle]).toEqual([null, null]);
  });
});
