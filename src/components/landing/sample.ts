/**
 * ILLUSTRATIVE sample data for landing previews only. Every surface that
 * renders this is labelled "Illustrative preview". Never used by the desk.
 */
export type SampleMarket = {
  id: string;
  title: string;
  category: string;
  yes: number;
  volume: string;
  flow: string;
  flowUp: boolean;
};

export const SAMPLE_MARKETS: SampleMarket[] = [
  { id: "s1", title: "Will SOL close the quarter above $250?", category: "Crypto", yes: 64, volume: "1.2K", flow: "+4.2", flowUp: true },
  { id: "s2", title: "Will the Fed cut rates at the next meeting?", category: "Finance", yes: 58, volume: "980", flow: "+2.1", flowUp: true },
  { id: "s3", title: "Will the home team win the league final?", category: "Sports", yes: 47, volume: "740", flow: "−1.3", flowUp: false },
  { id: "s4", title: "Will a new model top the public leaderboard this month?", category: "Tech", yes: 32, volume: "410", flow: "+0.8", flowUp: true },
];

/** Running YES share of flow (%) across sample prints, for the preview chart. */
export const SAMPLE_FLOW = [52, 50, 53, 55, 54, 57, 56, 58, 61, 60, 59, 62, 63, 61, 64, 66, 65, 64, 67, 66, 68, 67, 69, 70];
