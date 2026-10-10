/**
 * Public (API) shapes for the arena. Client-safe: no auth data, no tokens.
 * Scores are integers (hundredths / 1e-8) plus pre-formatted strings.
 */

import { MIN_RANKED_MARKETS, PRIOR_DISPLAY_C, PRIOR_WEIGHT, formatBrierE8, formatScoreC, reputationView, type Outcome, type ReputationRecord, type ScoreRecord } from "./scoring";

export const ARENA_METHODOLOGY = {
  minRankedMarkets: MIN_RANKED_MARKETS,
  priorScore: formatScoreC(PRIOR_DISPLAY_C),
  priorWeight: PRIOR_WEIGHT,
} as const;

export type PublicForecasterRow = {
  rank: number | null;
  wallet: string;
  ranked: boolean;
  scoredMarkets: number;
  pendingMarkets: number | null;
  avgScore: string;
  avgScoreC: number;
  adjustedScore: string;
  adjustedScoreC: number;
  meanBrier: string;
  meanBrierE8: number;
  firstScoredAt: string;
  lastScoredAt: string;
};

export type PublicScore = {
  roomId: string;
  /** null when the room is unlisted (scores still count; the room link stays private). */
  roomSlug: string | null;
  roomTitle: string | null;
  marketId: string;
  marketTitle: string | null;
  forecastRevision: number;
  probabilityBps: number;
  outcome: Outcome;
  brier: string;
  brierE8: number;
  score: string;
  scoreC: number;
  submittedAt: string;
  finalizedAt: string;
};

const iso = (ms: number) => new Date(ms).toISOString();

export function publicForecasterRow(r: ReputationRecord, rank: number | null, pending: number | null): PublicForecasterRow {
  const v = reputationView(r);
  return {
    rank: v.ranked ? rank : null,
    wallet: v.wallet,
    ranked: v.ranked,
    scoredMarkets: v.scoredCount,
    pendingMarkets: pending,
    avgScore: formatScoreC(v.avgDisplayC),
    avgScoreC: v.avgDisplayC,
    adjustedScore: formatScoreC(v.adjustedC),
    adjustedScoreC: v.adjustedC,
    meanBrier: formatBrierE8(v.meanBrierE8),
    meanBrierE8: v.meanBrierE8,
    firstScoredAt: iso(v.firstScoredAt),
    lastScoredAt: iso(v.lastScoredAt),
  };
}

export function publicScore(s: ScoreRecord, room: { slug: string; title: string; visibility: string } | null, marketTitle: string | null): PublicScore {
  const listed = room && room.visibility === "public";
  return {
    roomId: s.roomId,
    roomSlug: listed ? room.slug : null,
    roomTitle: listed ? room.title : null,
    marketId: s.marketId,
    marketTitle,
    forecastRevision: s.forecastRevision,
    probabilityBps: s.forecastProbabilityBps,
    outcome: s.resolvedOutcome,
    brier: formatBrierE8(s.brierE8),
    brierE8: s.brierE8,
    score: formatScoreC(s.displayScoreC),
    scoreC: s.displayScoreC,
    submittedAt: iso(s.forecastSubmittedAt),
    finalizedAt: iso(s.finalizedAt),
  };
}

export const forecasterPath = (wallet: string) => `/forecasters/${wallet}`;
