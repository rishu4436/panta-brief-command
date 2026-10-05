/**
 * Market hydration: catalog + raw detail merge is order-independent.
 * useMarket must re-merge when catalog arrives after a direct /markets/[id] nav.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { selectMergedMarket, resolveAuthoritativeMarket } from "@/lib/panta/catalog";
import { isPartialMarket, isPricelessDetail, mergeMarket } from "@/lib/panta/markets";
import { secondaryLastObservedPrices } from "@/lib/panta/prices";
import type { Market } from "@/lib/panta/domain";

const LONDON = "3z5yKwkE5Ds926uzxaVtuE3zpYDg7zj4KXwhQZHVbj9P";
const FRANCE = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";

const catalogPrimary = (over: Partial<Market> = {}): Market => ({
  marketId: LONDON,
  title: "Will it rain anywhere in London before 9pm BST on October 5th, 2026?",
  category: "weather",
  phase: "primary",
  status: "primary",
  yesPrice: "0.505",
  noPrice: "0.495",
  primaryYesPrice: "0.505",
  primaryNoPrice: "0.495",
  sources: { list: true, chain: true, detail: false },
  ...over,
});

const detailPrimaryPriceless = (over: Partial<Market> = {}): Market => ({
  marketId: LONDON,
  title: "Will it rain anywhere in London before 9pm BST on October 5th, 2026?",
  category: "weather",
  phase: "primary",
  status: "primary_active",
  yesPrice: null,
  noPrice: null,
  primaryYesPrice: null,
  primaryNoPrice: null,
  secondaryYesPrice: null,
  secondaryNoPrice: null,
  ...over,
});

const catalogSecondary = (over: Partial<Market> = {}): Market => ({
  marketId: FRANCE,
  title: "France will concede in the first 25 minutes against Belgium on the 05 October.",
  category: "sports",
  phase: "secondary",
  status: "secondary",
  yesPrice: null,
  noPrice: null,
  secondaryYesPrice: "506406474",
  secondaryNoPrice: "493593526",
  sources: { list: true, chain: true, detail: false },
  ...over,
});

const detailSecondaryPricelessWrongPhase = (over: Partial<Market> = {}): Market => ({
  marketId: FRANCE,
  title: "France will concede in the first 25 minutes against Belgium on the 05 October.",
  category: "sports",
  phase: "primary",
  status: "primary",
  yesPrice: null,
  noPrice: null,
  primaryYesPrice: null,
  primaryNoPrice: null,
  secondaryYesPrice: null,
  secondaryNoPrice: null,
  ...over,
});

describe("market hydration A–H (selectMergedMarket)", () => {
  it("A direct primary nav: detail first (priceless) then catalog → catalog price kept", () => {
    const detail = detailPrimaryPriceless();
    expect(isPricelessDetail(detail)).toBe(true);
    expect(isPartialMarket(detail)).toBe(false); // titled

    const afterDetailOnly = selectMergedMarket(undefined, LONDON, detail);
    expect(afterDetailOnly?.yesPrice).toBeNull();

    const afterCatalog = selectMergedMarket([catalogPrimary()], LONDON, detail);
    expect(afterCatalog?.yesPrice).toBe("0.505");
    expect(afterCatalog?.noPrice).toBe("0.495");
    expect(afterCatalog?.phase).toBe("primary");
  });

  it("B direct secondary: catalog secondary 0.506/0.494 (1e9 raw), detail priceless + stale primary phase → final secondary prices", () => {
    const detail = detailSecondaryPricelessWrongPhase();
    const catalog = catalogSecondary();
    const m = selectMergedMarket([catalog], FRANCE, detail)!;
    expect(m.phase).toBe("secondary");
    expect(m.secondaryYesPrice).toBe("506406474");
    expect(m.secondaryNoPrice).toBe("493593526");
    const obs = secondaryLastObservedPrices(m);
    expect(obs.yes).toBeCloseTo(0.506406474);
    expect(obs.no).toBeCloseTo(0.493593526);
  });

  it("C catalog-first same result as B", () => {
    const catalog = catalogSecondary();
    const detail = detailSecondaryPricelessWrongPhase();
    const m = selectMergedMarket([catalog], FRANCE, detail)!;
    expect(m.phase).toBe("secondary");
    expect(secondaryLastObservedPrices(m).yes).toBeCloseTo(0.506406474);
  });

  it("D detail enriches description / resolutionRule", () => {
    const catalog = catalogPrimary({ description: undefined, resolutionRule: undefined });
    const detail = detailPrimaryPriceless({
      yesPrice: "0.505",
      noPrice: "0.495",
      primaryYesPrice: "0.505",
      primaryNoPrice: "0.495",
      description: "Detail description",
      resolutionRule: "Official Met Office",
    });
    const m = selectMergedMarket([catalog], LONDON, detail)!;
    expect(m.description).toBe("Detail description");
    expect(m.resolutionRule).toBe("Official Met Office");
    expect(m.yesPrice).toBe("0.505");
  });

  it("E neither has price → null, no fallback", () => {
    const catalog = catalogPrimary({
      yesPrice: null,
      noPrice: null,
      primaryYesPrice: null,
      primaryNoPrice: null,
    });
    const detail = detailPrimaryPriceless();
    const m = selectMergedMarket([catalog], LONDON, detail)!;
    expect(m.yesPrice).toBeNull();
    expect(m.noPrice).toBeNull();
    expect(m.primaryYesPrice).toBeNull();
  });

  it("F secondary 0.70/0.40 stays 0.70/0.40 via secondaryLastObservedPrices, no normalization", () => {
    const catalog = catalogSecondary({
      secondaryYesPrice: "0.70",
      secondaryNoPrice: "0.40",
    });
    const m = selectMergedMarket([catalog], FRANCE, detailSecondaryPricelessWrongPhase())!;
    const obs = secondaryLastObservedPrices(m);
    expect(obs.yes).toBeCloseTo(0.7);
    expect(obs.no).toBeCloseTo(0.4);
    expect(obs.yes! + obs.no!).toBeCloseTo(1.1);
  });

  it("G lifecycle not downgraded (chain secondary + priceless primary-looking detail)", () => {
    const catalog = catalogSecondary();
    const detail = detailSecondaryPricelessWrongPhase({ phase: "primary", status: "primary" });
    const m = mergeMarket(catalog, detail);
    expect(m.phase).toBe("secondary");
    expect(m.status).toBe("secondary");
  });

  it("H order equivalence: detail→catalog == catalog→detail", () => {
    const catalog = [catalogSecondary()];
    const detail = detailSecondaryPricelessWrongPhase({
      description: "from detail",
    });
    const a = selectMergedMarket(undefined, FRANCE, detail);
    const a2 = selectMergedMarket(catalog, FRANCE, a ?? detail);
    const b2 = selectMergedMarket(catalog, FRANCE, detail);
    // Final authoritative views must match on prices + phase
    expect(a2?.phase).toBe(b2?.phase);
    expect(a2?.secondaryYesPrice).toBe(b2?.secondaryYesPrice);
    expect(a2?.secondaryNoPrice).toBe(b2?.secondaryNoPrice);
    expect(b2?.description).toBe("from detail");
    // Pure function: same inputs → same output
    expect(resolveAuthoritativeMarket(catalog[0], detail)).toEqual(b2);
  });
});

describe("useMarket wiring (source contract)", () => {
  it("stores raw detail and re-merges via selectMergedMarket + catalog subscription", () => {
    const hooks = readFileSync("src/lib/data/hooks.ts", "utf8");
    expect(hooks).toMatch(/selectMergedMarket\(/);
    expect(hooks).toMatch(/queryKey: qk\.catalog\(\)/);
    expect(hooks).toMatch(/preferFuller\(/);
    expect(hooks).not.toMatch(/const foundation = fromCatalog \?\? prev;/);
    expect(hooks).toMatch(/export function useMarket/);
  });
});

describe("priceless detail resolution is one-way", () => {
  it("keeps catalog lifecycle but honours an explicit resolved=true from a priceless detail", () => {
    const row = { marketId: "R1", title: "T", phase: "secondary", status: "secondary", resolved: false, yesPrice: "0.5", noPrice: "0.5" } as never;
    const detail = { marketId: "R1", title: "T", phase: "primary", status: "resolved", resolved: true, yesPrice: null, noPrice: null } as never;
    const m = mergeMarket(row, detail);
    expect(m.resolved).toBe(true);
    expect(m.phase).toBe("secondary");
    expect(m.yesPrice).toBe("0.5");
  });
});
