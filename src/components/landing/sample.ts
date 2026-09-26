/**
 * ILLUSTRATIVE sample data for landing previews only. Every surface that
 * renders this is labelled "Illustrative preview". Never used by the desk.
 *
 * The sample brief's evidence is computed by the real signals engine from
 * this sample market + tape, so the preview shows exactly what the desk
 * would show for such data. Its narrative is the real template's output
 * (pinned by test/sample-brief.test.ts).
 */
import type { Market, Trade } from "@/lib/panta/domain";
import { computeMarketSignals } from "@/lib/panta/signals";
import type { BriefPayload } from "@/lib/types";

/** Fixed clock so server and client render the same sample. */
export const SAMPLE_NOW_MS = Date.UTC(2026, 8, 20, 9, 30, 0);
const nowSec = SAMPLE_NOW_MS / 1000;

export const SAMPLE_MARKET: Market = {
  marketId: "sample-market-not-live",
  title: "Will SOL close the quarter above $250?",
  category: "Crypto",
  phase: "primary",
  status: "open",
  yesPrice: "0.64",
  noPrice: "0.36",
  volumeUsdc: "1240.50",
  endTime: nowSec + 41 * 86400,
  resolutionTime: nowSec + 42 * 86400,
  resolutionRule: "Resolves YES if the SOL/USD close on the last day of the quarter is above $250.",
};

export type SampleRow = { id: string; title: string; yes: number; phase: string; category: string; volume: string };

export const SAMPLE_ROWS: SampleRow[] = [
  { id: "s1", title: SAMPLE_MARKET.title, yes: 64, phase: "primary", category: "Crypto", volume: "1,240.50" },
  { id: "s2", title: "Will the Fed cut rates at the next meeting?", yes: 58, phase: "primary", category: "Finance", volume: "980.00" },
  { id: "s3", title: "Will the home team win the league final?", yes: 47, phase: "secondary", category: "Sports", volume: "740.25" },
  { id: "s4", title: "Will a new model top the public leaderboard this month?", yes: 32, phase: "primary", category: "Tech", volume: "410.00" },
];

// 24 prints over ~6 h, leaning YES; one wallet is a large share (a real risk flag).
const PATTERN: Array<["yes" | "no", number, string]> = [
  ["no", 40, "A"], ["yes", 35, "B"], ["yes", 60, "C"], ["no", 25, "D"], ["yes", 45, "W"], ["yes", 30, "E"],
  ["no", 20, "F"], ["yes", 55, "W"], ["yes", 40, "G"], ["no", 30, "H"], ["yes", 65, "W"], ["yes", 25, "I"],
  ["no", 15, "J"], ["yes", 50, "K"], ["yes", 70, "W"], ["no", 35, "L"], ["yes", 45, "M"], ["yes", 30, "N"],
  ["no", 20, "O"], ["yes", 60, "W"], ["yes", 40, "P"], ["no", 25, "Q"], ["yes", 55, "R"], ["yes", 35, "S"],
];

export const SAMPLE_TAPE: Trade[] = PATTERN.map(([side, shares, w], i) => ({
  id: `sample-${i}`,
  marketId: SAMPLE_MARKET.marketId,
  wallet: `Sample${w}Wallet`,
  signature: null,
  blockTime: nowSec - (PATTERN.length - i) * 900,
  isPrimary: true,
  kind: "buy",
  side,
  shares,
  amountUsdc: Math.round(shares * (side === "yes" ? 0.62 : 0.38) * 100) / 100,
}));

export const SAMPLE_SIGNALS = computeMarketSignals(SAMPLE_MARKET, SAMPLE_TAPE, SAMPLE_NOW_MS);

/** Output of buildTemplateBrief(SAMPLE_MARKET, SAMPLE_SIGNALS, "desk"); see test/sample-brief.test.ts. */
export const SAMPLE_NARRATIVE = "### Observation\nWill SOL close the quarter above $250? \u2014 the market prices YES at 64.0% (live spot). YES flow materially outweighs NO over the last 24 prints (78% of shares).\n\n### Evidence\n- Market probability: YES 64.0% / NO 36.0% (live spot).\n- Flow (share-weighted): YES 77.9% \u00b7 NO 22.1% across 24 prints (16 YES / 8 NO).\n- Price vs flow: flow is 13.9 pts above the market's YES probability.\n- Tape window: 24 prints over 5.8h; last print 15m ago.\n- Volume: catalog volume 1,240.5 USDC (lifetime); 538.6 USDC in the window.\n- Resolution: 1 Nov 2026, 3:00 pm IST (in 42.0d).\n\n### Risk\n- Primary quote (bonding-curve avgPrice) may differ from spot\n- Data quality **HIGH** \u2014 24 prints, share-weighted, live price, fresh tape\n\n### Execution considerations\n- Primary YES and NO available \u00b7 quote required before sizing\n- Fill price comes from the bonding-curve quote (avgPrice), not the spot label\n- Quotes last ~90s; builds ~120s (Panta session TTLs)\n\n_Deterministic template \u00b7 Summary \u00b7 signals v1 \u00b7 no recommendation_";

export const SAMPLE_BRIEF: BriefPayload = {
  market: SAMPLE_MARKET,
  tape: SAMPLE_TAPE,
  signals: SAMPLE_SIGNALS,
  narrative: SAMPLE_NARRATIVE,
  source: "template",
  mode: "desk",
  generatedAt: new Date(SAMPLE_NOW_MS).toISOString(),
};

/** Sample quote for the illustrative ticket (not a Panta response). */
export const SAMPLE_QUOTE = { amountUsdc: "25.00", shares: "38.42", side: "yes" as const, avgPrice: "0.6507", feeUsdc: "0.25" };

const istFmt = (sec: number) =>
  new Date(sec * 1000).toLocaleString("en-IN", { timeZone: "Asia/Calcutta", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const SAMPLE_ENDS_LABEL = `${istFmt(SAMPLE_MARKET.endTime as number)} IST`;
export const SAMPLE_RESOLVES_LABEL = `${istFmt(SAMPLE_MARKET.resolutionTime as number)} IST`;
