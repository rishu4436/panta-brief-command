/**
 * ILLUSTRATIVE values for the landing compositions (Landing v2). Every
 * surface that renders these carries an "Illustrative" label. No real users,
 * outcomes, citations or profits: forecasters are numbered placeholders,
 * sources are lettered placeholders, and the market is the landing's own
 * sample market (see ../sample.ts), never a live Panta market.
 */
import { SAMPLE_MARKET, SAMPLE_TAPE } from "../sample";

export const DEMO_MARKET = {
  title: SAMPLE_MARKET.title,
  category: SAMPLE_MARKET.category ?? "Crypto",
  yes: Math.round(Number(SAMPLE_MARKET.yesPrice) * 100),
  no: Math.round(Number(SAMPLE_MARKET.noPrice) * 100),
};

/**
 * Cumulative YES share of flow across the sample tape (the same quantity the
 * desk's activity chart plots: flow, not price).
 */
export const DEMO_FLOW: number[] = (() => {
  let yes = 0;
  let all = 0;
  return SAMPLE_TAPE.map((t) => {
    all += t.shares ?? 0;
    if (t.side === "yes") yes += t.shares ?? 0;
    return all ? yes / all : 0.5;
  });
})();

/** Ten 10-point buckets of free community forecasts (counts of wallets). */
export const DEMO_BUCKETS = [0, 1, 2, 3, 6, 9, 7, 4, 2, 1];
export const DEMO_PARTICIPANTS = DEMO_BUCKETS.reduce((a, b) => a + b, 0);
/** Bucket-midpoint mean, rounded: a coherent "community forecast" for the sample. */
export const DEMO_CONSENSUS = Math.round(DEMO_BUCKETS.reduce((a, n, i) => a + n * (i * 10 + 5), 0) / DEMO_PARTICIPANTS);

/** Placeholder forecasters for leaderboards: numbered, never wallet-like or named. */
export type DemoForecaster = { id: string; score: number; brier: string; scored: number; tier: "ranked" | "provisional"; trend: number[] };
export const DEMO_LEADERBOARD: DemoForecaster[] = [
  { id: "Forecaster 01", score: 88.4, brier: "0.116", scored: 14, tier: "ranked", trend: [70, 74, 79, 81, 85, 88] },
  { id: "Forecaster 02", score: 84.9, brier: "0.151", scored: 9, tier: "ranked", trend: [78, 76, 80, 83, 84, 85] },
  { id: "Forecaster 03", score: 81.2, brier: "0.188", scored: 11, tier: "ranked", trend: [72, 75, 74, 79, 80, 81] },
  { id: "Forecaster 04", score: 79.6, brier: "0.204", scored: 6, tier: "ranked", trend: [80, 77, 78, 79, 78, 80] },
  { id: "Forecaster 05", score: 76.1, brier: "0.239", scored: 3, tier: "provisional", trend: [75, 76] },
];
