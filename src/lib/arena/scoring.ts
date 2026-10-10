/**
 * Forecast scoring + reputation math (pure, shared by both storage adapters
 * so SQLite and Redis store identical integers). See docs/ARENA.md.
 *
 * Brier loss for one binary forecast:  p = bps / 10000, o = 1 (YES) or 0 (NO)
 *   Brier = (p − o)²            display = 100 × (1 − Brier)
 * Fixed point, exact integers:
 *   diffBps   = |bps − o × 10000|            (0..10000)
 *   brierE8   = diffBps²                     (0..100 000 000, units 1e-8)
 *   displayC  = round_half_up((1e8 − brierE8) / 1e4)  (hundredths: 0..10000)
 * e.g. 80 % & YES: diff 2000, brierE8 4 000 000 (0.04), display 96.00;
 *      80 % & NO:  diff 8000, brierE8 64 000 000 (0.64), display 36.00.
 * Rounding happens only when deriving hundredths for display; stored losses
 * are exact. Averages are computed from the exact SUM of brierE8.
 */

import { BPS_MAX, BPS_MIN } from "@/lib/forecasts/domain";

export type Outcome = "yes" | "no";

export const BRIER_E8_MAX = 100_000_000;
export const DISPLAY_C_MAX = 10_000;
/** Minimum scored (unique) markets before a forecaster is ranked; below it they are "Provisional". */
export const MIN_RANKED_MARKETS = 5;
/** Ranking prior: an always-50 % forecaster's display score (Brier 0.25 → 75.00). */
export const PRIOR_DISPLAY_C = 7_500;
/** Prior weight in markets (shrinks small samples toward the prior). */
export const PRIOR_WEIGHT = 5;

/** round_half_up(num / den) for num ≥ 0, den > 0, exact (BigInt). */
export function roundHalfUpDiv(num: number | bigint, den: number | bigint): number {
  const n = BigInt(num);
  const d = BigInt(den);
  if (n < BigInt(0) || d <= BigInt(0)) throw new RangeError("roundHalfUpDiv expects num ≥ 0 and den > 0");
  return Number((BigInt(2) * n + d) / (BigInt(2) * d));
}

const isBps = (v: number) => Number.isInteger(v) && v >= BPS_MIN && v <= BPS_MAX;

export function brierE8(probabilityBps: number, outcome: Outcome): number {
  if (!isBps(probabilityBps)) throw new RangeError("probabilityBps must be an integer 0..10000");
  if (outcome !== "yes" && outcome !== "no") throw new RangeError("outcome must be yes or no");
  const o = outcome === "yes" ? BPS_MAX : 0;
  const d = Math.abs(probabilityBps - o);
  return d * d;
}

export function displayScoreC(brier: number): number {
  if (!Number.isInteger(brier) || brier < 0 || brier > BRIER_E8_MAX) throw new RangeError("brierE8 out of range");
  return roundHalfUpDiv(BRIER_E8_MAX - brier, 10_000);
}

/** "96.00" from hundredths. */
export const formatScoreC = (c: number) => (c / 100).toFixed(2);
/** "0.0400" from 1e-8 units (4 decimals, round half up). */
export const formatBrierE8 = (e8: number) => (roundHalfUpDiv(e8, 10_000) / 10_000).toFixed(4);

// ------------------------------------------------------------------ revision selection

export type RevisionLike = { revision: number; probabilityBps: number; createdAt: number };

/**
 * The FINAL ACCEPTED revision strictly before the forecast cutoff: the highest
 * revision number whose server timestamp is < cutoffAt. Writes after the cutoff
 * are rejected at submit time; this re-verifies by timestamp anyway. null when
 * nothing qualifies (no forecast → no score).
 */
export function finalEligibleRevision<R extends RevisionLike>(revisions: readonly R[], cutoffAt: number): R | null {
  let best: R | null = null;
  for (const r of revisions) {
    if (!Number.isInteger(r.revision) || r.revision < 1 || !isBps(r.probabilityBps) || !Number.isFinite(r.createdAt)) continue;
    if (r.createdAt >= cutoffAt) continue;
    if (!best || r.revision > best.revision) best = r;
  }
  return best;
}

// ------------------------------------------------------------------ market scoring

export type SnapshotRevision = RevisionLike & { forecastId: string };
export type SnapshotForecaster = { wallet: string; forecastId: string; revisions: SnapshotRevision[] };
export type SnapshotRoom = { roomId: string; marketId: string; forecasters: SnapshotForecaster[] };
export type MarketForecastSnapshot = { marketId: string; rooms: SnapshotRoom[] };

export type ScoreRecord = {
  scoreId: string;
  roomId: string;
  marketId: string;
  wallet: string;
  forecastId: string;
  forecastRevision: number;
  forecastProbabilityBps: number;
  /** Server time of the scored revision (unix ms, < cutoff). */
  forecastSubmittedAt: number;
  /** Server time of the wallet's FIRST revision in this room (participation time). */
  firstForecastAt: number;
  resolvedOutcome: Outcome;
  brierE8: number;
  displayScoreC: number;
  finalizedAt: number;
};

/** The one score per (wallet, market) that counts toward reputation. */
export type GlobalScoreRecord = ScoreRecord;

/** Deterministic id (sha-free so it runs anywhere): room + wallet uniquely identify a room score. */
export const scoreIdFor = (roomId: string, wallet: string) => `sc_${roomId.slice(5)}_${wallet}`;

export function scoreRevision(
  room: { roomId: string; marketId: string },
  wallet: string,
  forecastId: string,
  revisions: readonly SnapshotRevision[],
  outcome: Outcome,
  cutoffAt: number,
  finalizedAt: number,
): ScoreRecord | null {
  const pick = finalEligibleRevision(revisions, cutoffAt);
  if (!pick) return null;
  const first = revisions.filter((r) => r.createdAt < cutoffAt).reduce((a, r) => (r.revision < a.revision ? r : a), pick);
  const b = brierE8(pick.probabilityBps, outcome);
  return {
    scoreId: scoreIdFor(room.roomId, wallet),
    roomId: room.roomId,
    marketId: room.marketId,
    wallet,
    forecastId,
    forecastRevision: pick.revision,
    forecastProbabilityBps: pick.probabilityBps,
    forecastSubmittedAt: pick.createdAt,
    firstForecastAt: first.createdAt,
    resolvedOutcome: outcome,
    brierE8: b,
    displayScoreC: displayScoreC(b),
    finalizedAt,
  };
}

/**
 * Room scores for every room on the market, plus the single GLOBAL score per
 * wallet: the room the wallet joined EARLIEST (earliest first-revision time,
 * tie → smallest roomId), using that room's final pre-cutoff revision. Extra
 * rooms on the same market can't add or improve a wallet's global record.
 */
export function computeMarketScores(snapshot: MarketForecastSnapshot, outcome: Outcome, cutoffAt: number, finalizedAt: number) {
  const roomScores: ScoreRecord[] = [];
  for (const room of [...snapshot.rooms].sort((a, b) => (a.roomId < b.roomId ? -1 : 1))) {
    if (room.marketId !== snapshot.marketId) continue;
    for (const f of [...room.forecasters].sort((a, b) => (a.wallet < b.wallet ? -1 : 1))) {
      const s = scoreRevision(room, f.wallet, f.forecastId, f.revisions, outcome, cutoffAt, finalizedAt);
      if (s) roomScores.push(s);
    }
  }
  const byWallet = new Map<string, ScoreRecord>();
  for (const s of roomScores) {
    const cur = byWallet.get(s.wallet);
    if (!cur || s.firstForecastAt < cur.firstForecastAt || (s.firstForecastAt === cur.firstForecastAt && s.roomId < cur.roomId)) byWallet.set(s.wallet, s);
  }
  const globalScores = [...byWallet.values()].sort((a, b) => (a.wallet < b.wallet ? -1 : 1));
  return { roomScores, globalScores };
}

// ------------------------------------------------------------------ reputation

export type ReputationRecord = {
  wallet: string;
  scoredCount: number;
  sumBrierE8: number;
  firstScoredAt: number;
  lastScoredAt: number;
};

export type ReputationView = ReputationRecord & {
  meanBrierE8: number;
  avgDisplayC: number;
  adjustedC: number;
  ranked: boolean;
  rankKey: string;
};

/** Mean Brier in 1e-8 units, round half up. */
export const meanBrierE8 = (r: Pick<ReputationRecord, "scoredCount" | "sumBrierE8">) => roundHalfUpDiv(r.sumBrierE8, r.scoredCount);

/** 100 × (1 − mean Brier) in hundredths, from the exact sum. */
export const avgDisplayC = (r: Pick<ReputationRecord, "scoredCount" | "sumBrierE8">) =>
  roundHalfUpDiv(BigInt(r.scoredCount) * BigInt(BRIER_E8_MAX) - BigInt(r.sumBrierE8), BigInt(r.scoredCount) * BigInt(10_000));

/**
 * Conservative ranking score (hundredths): the average display score shrunk
 * toward PRIOR_DISPLAY_C with PRIOR_WEIGHT pseudo-markets:
 *   adjusted = (Σ display_exact + PRIOR × K) / (n + K)
 * computed exactly from Σ brierE8 then rounded half up once.
 */
export function adjustedScoreC(r: Pick<ReputationRecord, "scoredCount" | "sumBrierE8">): number {
  const n = BigInt(r.scoredCount);
  const k = BigInt(PRIOR_WEIGHT);
  const num = n * BigInt(BRIER_E8_MAX) - BigInt(r.sumBrierE8) + BigInt(PRIOR_DISPLAY_C) * k * BigInt(10_000);
  return roundHalfUpDiv(num, (n + k) * BigInt(10_000));
}

const pad = (n: number, w: number) => String(Math.max(0, Math.trunc(n))).padStart(w, "0");
const COUNT_CAP = 9_999_999;

/**
 * Sort key whose plain byte order is the ranking order (same in SQLite
 * ORDER BY, Redis ZSET lex ties and JS):
 *   adjusted score desc → scored markets desc → mean Brier asc →
 *   earliest first score → wallet asc.
 */
export function rankKey(r: ReputationRecord): string {
  return [
    pad(DISPLAY_C_MAX - adjustedScoreC(r), 5),
    pad(COUNT_CAP - Math.min(r.scoredCount, COUNT_CAP), 7),
    pad(meanBrierE8(r), 9),
    pad(r.firstScoredAt, 15),
    r.wallet,
  ].join("|");
}

export const walletFromRankKey = (k: string) => k.slice(k.lastIndexOf("|") + 1);

export function reputationView(r: ReputationRecord): ReputationView {
  return {
    ...r,
    meanBrierE8: meanBrierE8(r),
    avgDisplayC: avgDisplayC(r),
    adjustedC: adjustedScoreC(r),
    ranked: r.scoredCount >= MIN_RANKED_MARKETS,
    rankKey: rankKey(r),
  };
}

/** Add this finalization's global scores (at most one per wallet) to the wallets' reputations. */
export function nextReputation(prev: ReputationRecord | null, wallet: string, added: readonly GlobalScoreRecord[]): ReputationRecord {
  const mine = added.filter((s) => s.wallet === wallet);
  if (!mine.length) throw new Error("nextReputation: no scores for this wallet");
  let r: ReputationRecord = prev ? { ...prev } : { wallet, scoredCount: 0, sumBrierE8: 0, firstScoredAt: Number.MAX_SAFE_INTEGER, lastScoredAt: 0 };
  for (const s of mine) {
    r = {
      wallet,
      scoredCount: r.scoredCount + 1,
      sumBrierE8: r.sumBrierE8 + s.brierE8,
      firstScoredAt: Math.min(r.firstScoredAt, s.finalizedAt),
      lastScoredAt: Math.max(r.lastScoredAt, s.finalizedAt),
    };
  }
  return r;
}
