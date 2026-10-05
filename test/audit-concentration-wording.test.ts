/**
 * Audit (Oct 2026 test pass): size concentration measures a wallet's share of
 * TRADED size in the tape window, not of shares held. The wording must not
 * imply ownership ("holds").
 */
import { describe, expect, it } from "vitest";
import type { Market, Trade } from "@/lib/panta/domain";
import { computeMarketSignals } from "@/lib/panta/signals";
import { printConcentrationLine, sizeConcentrationLine } from "@/lib/concentration";

const NOW = Date.UTC(2026, 9, 3, 3, 0, 0);
const market: Market = {
  marketId: "ALio3GkarKxXy8qLdZwiUJo6XhS5QvuKw4bZKzruYdP6",
  title: "Audit",
  category: "audit",
  phase: "secondary",
  yesPrice: "0.5",
  noPrice: "0.5",
};
const tape: Trade[] = Array.from({ length: 10 }, (_, i) => ({
  id: String(i),
  marketId: market.marketId,
  wallet: i < 8 ? "whale" : `w${i}`,
  signature: `s${i}`,
  blockTime: NOW / 1000 - 600 + i,
  isPrimary: false, // secondary-phase flow uses secondary prints only
  kind: "buy",
  side: i % 2 ? "no" : "yes",
  shares: i < 8 ? 100 : 1,
  amountUsdc: null,
}));

describe("audit: concentration wording", () => {
  const s = computeMarketSignals(market, tape, NOW);
  it("the size-concentration risk flag does not say the wallet holds shares", () => {
    const flag = s.riskFlags.find((f) => f.id === "concentrated_size");
    expect(flag).toBeTruthy();
    expect(flag!.label).not.toMatch(/\bholds?\b/i);
    expect(flag!.label).toMatch(/traded shares/);
  });
  it("the brief evidence line does not say the wallet holds shares", () => {
    const line = sizeConcentrationLine(s);
    expect(line).not.toMatch(/\bholds?\b/i);
    expect(line).toMatch(/traded shares/);
  });
});

describe("concentration wording (exact phrasing)", () => {
  const s = computeMarketSignals(market, tape, NOW);
  it("size: 'accounts for X% of observed traded shares'", () => {
    expect(sizeConcentrationLine(s)).toMatch(/top wallet accounts for \d+\.\d% of observed traded shares/);
    expect(s.riskFlags.find((f) => f.id === "concentrated_size")!.label).toMatch(
      /top wallet accounts for \d+\.\d% of observed traded shares/,
    );
  });
  it("prints: 'made X% of observed prints'", () => {
    expect(printConcentrationLine(s)).toMatch(/top wallet made \d+\.\d% of observed prints/);
  });
  it("no product copy, prompt or sample says a wallet holds traded shares", async () => {
    const { readFileSync } = await import("node:fs");
    const files = [
      "src/lib/concentration.ts",
      "src/lib/panta/signals.ts",
      "src/lib/brief.ts",
      "src/components/landing/sample.ts",
      "src/components/landing/AIBriefShowcase.tsx",
      "src/components/AiBrief.tsx",
    ];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\bholds?\s+\$?\{?[^\n]{0,40}%\s*of/i);
      expect(text, f).not.toMatch(/holds? [^\n]{0,30}of traded/i);
    }
  });
});
