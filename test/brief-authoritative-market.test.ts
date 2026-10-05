/**
 * /api/brief must use the same authoritative market as the catalog: on-chain
 * / catalog lifecycle merged with detail. A partial Panta detail (no title,
 * no prices, stale "primary" phase) must never make a known secondary market
 * look primary in signals or in the AI prompt input.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTemplateBrief, maybeOpenAIBrief } from "@/lib/brief";
import { resolveAuthoritativeMarket, withDetail } from "@/lib/panta/catalog";
import type { Market } from "@/lib/panta/domain";
import { isPartialMarket, preferFuller } from "@/lib/panta/markets";
import { marketProbability } from "@/lib/panta/prices";
import { computeMarketSignals } from "@/lib/panta/signals";

const ID = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";

const primaryFull = (): Market => ({
  marketId: ID,
  title: "Will it rain in Mumbai tomorrow?",
  category: "weather",
  phase: "primary",
  status: "primary",
  description: "IMD rainfall.",
  resolutionRule: "YES if IMD reports rain.",
  yesPrice: "0.55",
  noPrice: "0.45",
  primaryYesPrice: "0.55",
  primaryNoPrice: "0.45",
  volumeUsdc: "12.5",
  sources: { list: true, chain: true, detail: true },
});

const secondaryFull = (): Market => ({
  marketId: ID,
  title: "Secondary market title",
  category: "crypto",
  phase: "secondary",
  status: "secondary",
  description: "Graduated to secondary.",
  resolutionRule: "YES if price > X.",
  // Independent per-side last trades — deliberately NOT complementary.
  yesPrice: "0.80",
  noPrice: "0.80",
  primaryYesPrice: "0.50",
  primaryNoPrice: "0.50",
  secondaryYesPrice: "800000000",
  secondaryNoPrice: "800000000",
  volumeUsdc: "100",
  sources: { list: true, chain: true, detail: true },
});

/** What Panta's detail endpoint intermittently returns for a live secondary market. */
const partialStalePrimary = (): Market => ({
  marketId: ID,
  title: "",
  category: "",
  phase: "primary", // stale
  status: "primary",
});

/** Catalog/on-chain row for the same market (authoritative lifecycle). */
const catalogSecondary = (): Market => ({
  marketId: ID,
  title: "Secondary market title",
  category: "crypto",
  phase: "secondary",
  status: "secondary",
  resolutionRule: "YES if price > X.",
  primaryYesPrice: "0.50",
  primaryNoPrice: "0.50",
  volumeUsdc: "100",
  sources: { list: true, chain: true, detail: false },
});

afterEach(() => vi.restoreAllMocks());

describe("resolveAuthoritativeMarket (catalog + detail)", () => {
  it("full primary detail → primary phase kept", () => {
    const row = {
      marketId: ID,
      title: "Will it rain in Mumbai tomorrow?",
      category: "weather",
      phase: "primary",
      status: "primary",
      sources: { list: true, chain: true, detail: false },
    } satisfies Market;
    const m = resolveAuthoritativeMarket(row, primaryFull())!;
    expect(m.phase).toBe("primary");
    expect(m.title).toBe("Will it rain in Mumbai tomorrow?");
    expect(m.yesPrice).toBe("0.55");
  });

  it("full secondary detail → secondary phase and title/prices preserved", () => {
    const m = resolveAuthoritativeMarket(catalogSecondary(), secondaryFull())!;
    expect(m.phase).toBe("secondary");
    expect(m.title).toBe("Secondary market title");
    expect(m.yesPrice).toBe("0.80");
  });

  it("partial secondary detail with stale primary phase → authoritative secondary phase survives", () => {
    const partial = partialStalePrimary();
    expect(isPartialMarket(partial)).toBe(true);
    const m = resolveAuthoritativeMarket(catalogSecondary(), partial)!;
    expect(m.phase).toBe("secondary");
    expect(m.status).toBe("secondary");
    expect(m.title).toBe("Secondary market title");
    expect(m.resolutionRule).toBe("YES if price > X.");
    expect(m.volumeUsdc).toBe("100");
    // preferFuller alone would also keep the fuller record, but only when it
    // is already the `prev`; the brief path must merge even on a first fetch.
    expect(preferFuller(catalogSecondary(), partial).phase).toBe("secondary");
  });

  it("missing title/price partial detail → fuller catalog/on-chain data survives", () => {
    const m = resolveAuthoritativeMarket(catalogSecondary(), partialStalePrimary())!;
    expect(m.title).toBeTruthy();
    expect(m.primaryYesPrice).toBe("0.50");
    expect(m.sources?.chain).toBe(true);
    expect(m.sources?.detail).toBe(true);
  });

  it("detail-only (no catalog row) returns the detail as-is", () => {
    expect(resolveAuthoritativeMarket(null, secondaryFull())?.phase).toBe("secondary");
    expect(resolveAuthoritativeMarket(undefined, null)).toBeNull();
  });

  it("withDetail is the same merge the catalog builder uses", () => {
    expect(withDetail(catalogSecondary(), partialStalePrimary()).phase).toBe("secondary");
  });
});

describe("deterministic signals from authoritative market", () => {
  it("full primary detail → primary execution semantics", () => {
    const s = computeMarketSignals(primaryFull(), [], Date.now());
    expect(s.phase).toBe("primary");
    expect(s.execution.primaryOpen).toBe(true);
    expect(s.execution.lines.some((l) => /Primary YES and NO available/.test(l))).toBe(true);
    expect(s.execution.lines.some((l) => /bonding-curve quote/.test(l))).toBe(true);
    expect(s.execution.lines.some((l) => /Secondary phase/.test(l))).toBe(false);
  });

  it("full secondary detail → secondary execution semantics (no bonding-curve / primary quote language)", () => {
    const s = computeMarketSignals(secondaryFull(), [], Date.now());
    expect(s.phase).toBe("secondary");
    expect(s.execution.primaryOpen).toBe(false);
    expect(s.execution.lines).toEqual([
      "Secondary phase · primary buys closed",
      "This desk routes primary buys only; secondary AMM routing is out of scope",
    ]);
    expect(s.execution.lines.join(" ")).not.toMatch(/bonding-curve|quote required|Primary YES/);
  });

  it("partial stale-primary detail merged with catalog → secondary execution, not primary", () => {
    const m = resolveAuthoritativeMarket(catalogSecondary(), partialStalePrimary())!;
    const s = computeMarketSignals(m, [], Date.now());
    expect(s.phase).toBe("secondary");
    expect(s.execution.primaryOpen).toBe(false);
    expect(s.execution.lines[0]).toMatch(/Secondary phase · primary buys closed/);
    expect(s.execution.lines.join("\n")).not.toMatch(/Primary YES|bonding-curve|quote required/);
    // Contrast: the raw partial alone would wrongly open primary.
    const bad = computeMarketSignals(partialStalePrimary(), [], Date.now());
    expect(bad.phase).toBe("primary");
    expect(bad.execution.primaryOpen).toBe(true);
  });

  it("secondary independent prices remain unavailable as probability", () => {
    const m = resolveAuthoritativeMarket(catalogSecondary(), secondaryFull())!;
    const p = marketProbability(m);
    expect(p.source).toBe("unavailable");
    expect(p.reason).toBe("inconsistent_prices");
    expect(p.yes).toBeNull();
    const s = computeMarketSignals(m, [], Date.now());
    expect(s.probability.source).toBe("unavailable");
    expect(s.probability.yes).toBeNull();
    // Must not fall back to the graduation (primary_curve) prices for secondary.
    expect(s.probability.source).not.toBe("primary_curve");
  });

  it("primary probability behavior remains unchanged (spot / primary_curve)", () => {
    const spot = computeMarketSignals(primaryFull(), [], Date.now());
    expect(spot.probability).toMatchObject({ yes: 0.55, no: 0.45, source: "spot" });
    const curveOnly: Market = {
      ...primaryFull(),
      yesPrice: null,
      noPrice: null,
      primaryYesPrice: "0.62",
      primaryNoPrice: "0.38",
    };
    const curve = computeMarketSignals(curveOnly, [], Date.now());
    expect(curve.probability).toMatchObject({ yes: 0.62, no: 0.38, source: "primary_curve" });
    // Secondary must not use primary_curve even when spot is missing.
    const secNoSpot: Market = {
      ...secondaryFull(),
      yesPrice: null,
      noPrice: null,
    };
    expect(marketProbability(secNoSpot).source).toBe("unavailable");
  });
});

describe("AI brief receives normalized authoritative market data", () => {
  it("template + OpenAI input use the merged market's phase (secondary, not stale primary)", async () => {
    const m = resolveAuthoritativeMarket(catalogSecondary(), partialStalePrimary())!;
    const signals = computeMarketSignals(m, [], Date.now());
    const narrative = buildTemplateBrief(m, signals, "desk");
    expect(narrative).toMatch(/Secondary phase · primary buys closed/);
    expect(narrative).not.toMatch(/Primary YES and NO available|bonding-curve quote/);
    expect(narrative).not.toMatch(/\bprimary phase\b/i);

    vi.stubEnv("OPENAI_API_KEY", "");
    const { narrative: again, source } = await maybeOpenAIBrief(m, signals, "desk");
    expect(source).toBe("template");
    expect(again).toBe(narrative);
    // When a key is set, the prompt payload must carry the authoritative phase.
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-used");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const user = body.messages.find((x: { role: string }) => x.role === "user").content as string;
      expect(user).toMatch(/"phase":\s*"secondary"/);
      expect(user).not.toMatch(/"phase":\s*"primary"/);
      return new Response(JSON.stringify({ error: { message: "forced fallback" } }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await maybeOpenAIBrief(m, signals, "desk");
    expect(out.source).toBe("template");
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("/api/brief uses getAuthoritativeMarket (not bare getMarketServer); browser still sends only marketId+mode", () => {
    const route = readFileSync("src/app/api/brief/route.ts", "utf8");
    expect(route).toMatch(/getAuthoritativeMarket\(marketId\)/);
    expect(route).not.toMatch(/getMarketServer\(/);
    expect(route).toMatch(/ALLOWED_KEYS = new Set\(\["marketId", "mode"\]\)/);
    const server = readFileSync("src/lib/panta/catalog-server.ts", "utf8");
    expect(server).toMatch(/export async function getAuthoritativeMarket/);
    expect(server).toMatch(/resolveAuthoritativeMarket\(row, detail\)/);
  });

  it("useMarket merges catalog foundation so a partial detail cannot demote secondary → primary", () => {
    const hooks = readFileSync("src/lib/data/hooks.ts", "utf8");
    expect(hooks).toMatch(/const foundation = fromCatalog \?\? prev;/);
    expect(hooks).toMatch(/resolveAuthoritativeMarket\(foundation, next\)/);
    expect(hooks).not.toMatch(/preferFuller\(/);
  });
});
