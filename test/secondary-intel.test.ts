/**
 * Phase 2 — Secondary Market Intelligence (read-only).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTemplateBrief } from "@/lib/brief";
import type { Market, Trade } from "@/lib/panta/domain";
import { computeMarketSignals } from "@/lib/panta/signals";
import {
  buildSecondarySnapshot,
  filterSecondaryPrints,
  flowDirectionLabel,
  isSecondaryMarket,
  ORDER_BOOK_DEPTH_UNAVAILABLE,
  pantaMarketUrl,
  pickSecondaryRadarCandidates,
  secondaryActivityScore,
  secondaryFlow,
  secondaryObservedPrices,
  secondaryTapeQuality,
  showsPrimaryBuyTicket,
  showsSecondaryIntelligence,
  sortRadarRows,
  type RadarRow,
} from "@/lib/panta/secondary-intel";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const NOW_SEC = Math.floor(NOW / 1000);

const mkt = (over: Partial<Market> = {}): Market => ({
  marketId: over.marketId ?? "secMkt1111111111111111111111111111111111111",
  title: over.title ?? "Secondary title",
  category: "crypto",
  phase: "secondary",
  status: "secondary",
  yesPrice: "0.80",
  noPrice: "0.80",
  secondaryYesPrice: "800000000",
  secondaryNoPrice: "800000000",
  endTime: NOW_SEC + 86_400,
  resolutionTime: NOW_SEC + 86_400,
  volumeUsdc: "50",
  ...over,
});

const trade = (over: Partial<Trade> & { i: number }): Trade => ({
  id: String(over.i),
  marketId: "m",
  wallet: over.wallet ?? `w${over.i % 3}`,
  signature: `sig${over.i}`,
  blockTime: NOW_SEC - 600 + over.i * 10,
  isPrimary: over.isPrimary ?? false,
  kind: "buy",
  side: over.side ?? "yes",
  shares: over.shares ?? 10,
  amountUsdc: over.amountUsdc ?? null,
});

describe("secondary classification + gating", () => {
  it("classifies secondary / trading and gates primary buy UI", () => {
    expect(isSecondaryMarket(mkt())).toBe(true);
    expect(showsSecondaryIntelligence(mkt())).toBe(true);
    expect(showsPrimaryBuyTicket(mkt())).toBe(false);
    expect(showsPrimaryBuyTicket(mkt({ phase: "primary", status: "primary", endTime: NOW_SEC + 99999 }))).toBe(true);
    expect(showsSecondaryIntelligence(mkt({ phase: "primary", status: "primary" }))).toBe(false);
  });
});

describe("secondary prices", () => {
  it("decodes independent YES/NO last observed prices (not complementary)", () => {
    const px = secondaryObservedPrices(mkt());
    expect(px.label).toBe("Last observed secondary prices");
    expect(px.yesLabel).toBe("Last observed YES secondary price");
    expect(px.noLabel).toBe("Last observed NO secondary price");
    expect(px.yes).toBeCloseTo(0.8);
    expect(px.no).toBeCloseTo(0.8);
    expect(px.yes! + px.no!).toBeGreaterThan(1); // deliberately not forced to 1
  });

  it("never falls back to primary curve for secondary display prices when secondary* missing and phase secondary uses yes/no", () => {
    const px = secondaryObservedPrices(
      mkt({ secondaryYesPrice: null, secondaryNoPrice: null, yesPrice: "0.55", noPrice: "0.70", primaryYesPrice: "0.5", primaryNoPrice: "0.5" }),
    );
    expect(px.yes).toBeCloseTo(0.55);
    expect(px.no).toBeCloseTo(0.7);
  });


  it("raw secondary* 0 means no observation (—), never 0.00; 1e9 is real 1.00", () => {
    const ansem = secondaryObservedPrices(
      mkt({ secondaryYesPrice: "0", secondaryNoPrice: "800000000", yesPrice: "0.568", noPrice: "0.8" }),
    );
    expect(ansem.yes).toBeNull();
    expect(ansem.no).toBeCloseTo(0.8);
    expect(ansem.observedAtLabel).toBe("time not provided");
    const dangote = secondaryObservedPrices(
      mkt({ secondaryYesPrice: "1000000000", secondaryNoPrice: "1000000000" }),
    );
    expect(dangote.yes).toBe(1);
    expect(dangote.no).toBe(1);
    const franceList = secondaryObservedPrices(
      mkt({ secondaryYesPrice: "0.506406474", secondaryNoPrice: "0.493593526" }),
    );
    expect(franceList.yes).toBeCloseTo(0.506406474);
    expect(franceList.no).toBeCloseTo(0.493593526);
  });

  it("primary market does not invent secondary prices from yes/no alone via secondary* path", () => {
    const px = secondaryObservedPrices(
      mkt({ phase: "primary", status: "primary", secondaryYesPrice: null, secondaryNoPrice: null, yesPrice: "0.6", noPrice: "0.4" }),
    );
    expect(px.yes).toBeNull();
    expect(px.no).toBeNull();
  });
});

describe("secondary tape + flow", () => {
  it("filters isPrimary === false only", () => {
    const tape = [
      trade({ i: 0, isPrimary: true, side: "yes" }),
      trade({ i: 1, isPrimary: false, side: "yes" }),
      trade({ i: 2, isPrimary: false, side: "no" }),
      { ...trade({ i: 3, side: "yes" }), isPrimary: null },
    ];
    const sec = filterSecondaryPrints(tape);
    expect(sec).toHaveLength(2);
    expect(sec.every((t) => t.isPrimary === false)).toBe(true);
  });

  it("flow: shares basis, imbalance, one-sided / balanced flags", () => {
    const prints = [
      ...Array.from({ length: 8 }, (_, i) => trade({ i, side: "yes", shares: 10 })),
      ...Array.from({ length: 2 }, (_, i) => trade({ i: i + 8, side: "no", shares: 10 })),
    ];
    const f = secondaryFlow(prints, NOW);
    expect(f.basis).toBe("shares");
    expect(f.yesShare).toBeCloseTo(0.8);
    expect(f.noShare).toBeCloseTo(0.2);
    expect(f.imbalance).toBeCloseTo(0.6);
    expect(f.oneSided).toBe(false);
    expect(f.balanced).toBe(false);
    expect(f.printCount).toBe(10);
    expect(f.tradedShares).toBe(100);
    expect(f.uniqueWallets).toBe(3);
  });

  it("partial tape and failed tape quality", () => {
    expect(
      secondaryTapeQuality({
        isError: false,
        isPending: false,
        hasData: true,
        completeness: { complete: false, returned: 10, parsed: 7, dropped: 3 },
        secondaryPrintCount: 7,
      }),
    ).toMatchObject({ kind: "partial", label: "Partial sample", dropped: 3 });
    expect(
      secondaryTapeQuality({
        isError: true,
        isPending: false,
        hasData: false,
        completeness: null,
        secondaryPrintCount: 0,
      }),
    ).toMatchObject({ kind: "failed" });
  });
});

describe("activity score + radar", () => {
  it("activity score is deterministic", () => {
    const input = {
      secondaryPrintCount: 10,
      tradedShares: 100,
      latestPrintAgeMinutes: 30,
      uniqueWallets: 5,
      minutesToResolution: 120,
    };
    expect(secondaryActivityScore(input)).toBe(secondaryActivityScore(input));
    expect(secondaryActivityScore(input)).toBeGreaterThan(secondaryActivityScore({ ...input, secondaryPrintCount: 0 }));
  });

  it("radar ordering is stable with tie-breaks", () => {
    const base = buildSecondarySnapshot(mkt({ marketId: "a", volumeUsdc: "1" }), [], NOW, { kind: "ok" });
    const rows: RadarRow[] = [
      { ...base, marketId: "b", activityScore: 10, flow: { ...base.flow, printCount: 2 }, flowDirection: "—" },
      { ...base, marketId: "a", activityScore: 10, flow: { ...base.flow, printCount: 2 }, flowDirection: "—" },
      { ...base, marketId: "c", activityScore: 20, flow: { ...base.flow, printCount: 1 }, flowDirection: "—" },
    ];
    const sorted = sortRadarRows(rows);
    expect(sorted.map((r) => r.marketId)).toEqual(["c", "a", "b"]);
  });

  it("candidate picker bounds and prefers volume", () => {
    const markets = [
      mkt({ marketId: "low", volumeUsdc: "1" }),
      mkt({ marketId: "high", volumeUsdc: "900" }),
      mkt({ marketId: "mid", volumeUsdc: "50" }),
      mkt({ marketId: "pri", phase: "primary", status: "primary", volumeUsdc: "9999" }),
    ];
    const picked = pickSecondaryRadarCandidates(markets, 2, NOW_SEC);
    expect(picked).toHaveLength(2);
    expect(picked.map((m) => m.marketId)).toEqual(["high", "mid"]);
  });
});

describe("primary execution UI gating + brief language", () => {
  it("source: MarketDetail hides PrimaryBuyPanel on secondary", () => {
    const src = readFileSync("src/components/MarketDetail.tsx", "utf8");
    expect(src).toMatch(/showsSecondaryIntelligence/);
    expect(src).toMatch(/SecondaryIntelligence/);
    expect(src).toMatch(/secondaryDesk \? \(/);
    expect(src).toMatch(/PrimaryBuyPanel/);
  });

  it("template brief for secondary never uses primary probability / bonding-curve language", () => {
    const market = mkt();
    const s = computeMarketSignals(market, [trade({ i: 0 }), trade({ i: 1, side: "no" })], NOW);
    const narrative = buildTemplateBrief(market, s, "desk");
    expect(narrative).toMatch(/Secondary phase · primary buys closed/);
    expect(narrative).toMatch(/secondary CLOB execution is not currently routed/);
    expect(narrative).toMatch(/Last observed YES secondary price/);
    expect(narrative).not.toMatch(/Market probability: YES/);
    expect(narrative).not.toMatch(/bonding-curve/);
    expect(narrative).not.toMatch(/Primary YES and NO available/);
    expect(narrative).not.toMatch(new RegExp(`secondary\\s+${"amm"}`, "i"));
    expect(narrative).not.toMatch(/YES\+NO=1/i);
  });

  it("depth limitation copy is product limitation, not an error tone keyword in module", () => {
    expect(ORDER_BOOK_DEPTH_UNAVAILABLE).toMatch(/Order-book depth unavailable/);
    expect(flowDirectionLabel(secondaryFlow([], NOW))).toMatch(/No observed secondary prints — secondary flow unavailable/);
  });

  it("panta market URL uses proven /market/{id} pattern", () => {
    expect(pantaMarketUrl("5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v")).toBe(
      "https://panta.market/market/5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v",
    );
  });
});


describe("secondary signals: no inconsistent-price defect; flow labels", () => {
  it("does not flag inconsistent_prices or cap quality for complementary-looking secondary spot", async () => {
    const { computeMarketSignals } = await import("@/lib/panta/signals");
    const { buildTemplateBrief } = await import("@/lib/brief");
    const market = mkt({
      yesPrice: "0.506406474",
      noPrice: "0.493593526",
      secondaryYesPrice: "506406474",
      secondaryNoPrice: "493593526",
    });
    const primaryPrints = Array.from({ length: 11 }, (_, i) =>
      trade({ i, isPrimary: true, side: i % 2 === 0 ? "yes" : "no", shares: 10 }),
    );
    const s = computeMarketSignals(market, primaryPrints, NOW);
    expect(s.probability.reason).toBe("not_applicable");
    expect(s.riskFlags.map((f) => f.id)).not.toContain("inconsistent_prices");
    expect(s.dataQuality.reasons.join(" · ")).not.toMatch(/inconsistent/i);
    expect(s.headline).toMatch(/No observed secondary prints — secondary flow unavailable/i);
    expect(s.headline).toMatch(/historical primary/i);
    expect(s.flow.yesFlowShare).toBeNull();
    expect(s.tape.secondaryPrints).toBe(0);
    const text = buildTemplateBrief(market, s, "desk");
    expect(text).toMatch(/No observed secondary prints — secondary flow unavailable/i);
    expect(text).toMatch(/historical primary/i);
    expect(text).not.toMatch(/YES\/NO prices are inconsistent/i);
    expect(text).not.toMatch(/flow favors/i);
  });

  it("primary incoherent prices still warn and cap quality", async () => {
    const { computeMarketSignals } = await import("@/lib/panta/signals");
    const s = computeMarketSignals(
      mkt({
        phase: "primary",
        status: "primary",
        yesPrice: "1",
        noPrice: "1",
        secondaryYesPrice: null,
        secondaryNoPrice: null,
      }),
      [],
      NOW,
    );
    expect(s.probability.reason).toBe("inconsistent_prices");
    expect(s.riskFlags.map((f) => f.id)).toContain("inconsistent_prices");
    expect(s.dataQuality.grade).toBe("low");
  });
});

describe("no obsolete secondary market AMM label remains", () => {
  it("repo grep over src/test and root .md (excl node_modules/.next)", () => {
    const hits: string[] = [];
    const label = ["sec" + "ondary", "a" + "mm"].join(" ");
    const walk = (p: string) => {
      const st = statSync(p);
      if (st.isDirectory()) {
        if (p.includes("node_modules") || p.includes(".next")) return;
        for (const name of readdirSync(p)) walk(join(p, name));
        return;
      }
      if (!/\.(ts|tsx|md|js|mjs|cjs)$/.test(p)) return;
      // Skip this assertion file (constructs the needle without storing the phrase).
      if (p.replace(/\\/g, "/").endsWith("test/secondary-intel.test.ts")) return;
      const text = readFileSync(p, "utf8").toLowerCase();
      if (text.includes(label) || text.includes("secondaryamm")) hits.push(p);
    };
    walk("src");
    walk("test");
    // Root markdown (UX_SCORE.md, README.md, AGENTS.md, …) — exclude node_modules/.next via walk dirs only.
    for (const name of readdirSync(".")) {
      if (name.endsWith(".md") && !name.startsWith(".")) walk(name);
    }
    expect(hits).toEqual([]);
  });
});
