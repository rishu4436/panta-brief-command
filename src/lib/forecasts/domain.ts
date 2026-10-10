/**
 * Free community forecasting: domain model + validation (pure; safe for
 * client and server).
 *
 * A forecast is a wallet's free YES probability for the Panta market a room
 * references. It is stored separately from the room (keyed by roomId) and is
 * never money, a position or a Panta price:
 *
 *  - probability is an integer in basis points, 0..10000 (0.00 %..100.00 %);
 *  - one CURRENT forecast per (room, wallet), revised in place with an
 *    incrementing revision number;
 *  - every submission is appended to an immutable revision history.
 *
 * The community forecast is the unweighted mean of CURRENT forecasts, one per
 * participant, computed server-side (see aggregate helpers below).
 */

import { z } from "zod";
import { IDEMPOTENCY_KEY_RE, ROOM_ID_RE, cleanMultiline } from "@/lib/rooms/domain";

export const BPS_MIN = 0;
export const BPS_MAX = 10_000;
export const REASONING_MAX = 1_000;
/** Histogram of current forecasts: 10 buckets of 10 points; 100 % falls in the last. */
export const BUCKET_COUNT = 10;
export const MAX_REVISION = 1_000_000;

export const LIST_LIMIT_MAX = 50;
export const HISTORY_LIMIT_MAX = 100;
export const LIST_OFFSET_MAX = 10_000;

/** Current forecast (server record; timestamps are unix ms, server clock). */
export type ForecastRecord = {
  forecastId: string;
  roomId: string;
  wallet: string;
  probabilityBps: number;
  reasoning: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

/** One immutable entry of a wallet's history in a room. */
export type ForecastRevisionRecord = {
  forecastId: string;
  roomId: string;
  wallet: string;
  revision: number;
  probabilityBps: number;
  reasoning: string;
  createdAt: number;
};

/** Running totals over CURRENT forecasts (one per participant). */
export type ForecastAggregate = {
  participants: number;
  sumBps: number;
  /** BUCKET_COUNT counts; bucket i covers [i*1000, (i+1)*1000) bps, 10000 in the last. */
  buckets: number[];
};

export const FORECAST_ID_RE = /^fc_[a-f0-9]{24}$/;

export const charLen = (s: string) => [...s].length;

export function bucketOf(bps: number): number {
  return Math.min(BUCKET_COUNT - 1, Math.floor(bps / (BPS_MAX / BUCKET_COUNT)));
}

export const emptyAggregate = (): ForecastAggregate => ({ participants: 0, sumBps: 0, buckets: Array(BUCKET_COUNT).fill(0) });

export type Consensus =
  | { kind: "empty"; participants: 0; buckets: number[] }
  | { kind: "consensus"; participants: number; meanBps: number; buckets: number[] };

/** No forecasts → no mean at all (never 0 % or 50 %). Mean rounded to whole bps. */
export function consensusFrom(a: ForecastAggregate): Consensus {
  const buckets = a.buckets.length === BUCKET_COUNT ? a.buckets.map((n) => Math.max(0, n)) : emptyAggregate().buckets;
  if (a.participants <= 0) return { kind: "empty", participants: 0, buckets };
  return { kind: "consensus", participants: a.participants, meanBps: Math.round(a.sumBps / a.participants), buckets };
}

// ---------------------------------------------------------------------------
// Input

/** Keys that would let a client name the forecasting wallet. Always rejected. */
export const CLIENT_IDENTITY_KEYS = ["wallet", "walletAddress", "address", "owner", "creatorWallet", "publicKey"] as const;

const Reasoning = z
  .string()
  .max(REASONING_MAX * 4, `Reasoning can be at most ${REASONING_MAX} characters.`)
  .transform(cleanMultiline)
  .refine((s) => charLen(s) <= REASONING_MAX, `Reasoning can be at most ${REASONING_MAX} characters.`);

export const SubmitForecastInput = z.strictObject({
  roomId: z.string().regex(ROOM_ID_RE, "Invalid room id."),
  probabilityBps: z
    .number({ error: "probabilityBps must be a whole number from 0 to 10000." })
    .int("probabilityBps must be a whole number from 0 to 10000.")
    .min(BPS_MIN, "probabilityBps must be a whole number from 0 to 10000.")
    .max(BPS_MAX, "probabilityBps must be a whole number from 0 to 10000."),
  reasoning: Reasoning.default(""),
  /** 0 = first forecast; otherwise the revision the client is editing (lost-update guard). */
  expectedRevision: z.number().int().min(0).max(MAX_REVISION),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_RE, "Invalid idempotency key."),
});
export type SubmitForecastInput = z.infer<typeof SubmitForecastInput>;

/** The fields that define "the same submission" for idempotency. */
export function forecastRequestFingerprint(i: Pick<SubmitForecastInput, "roomId" | "probabilityBps" | "reasoning" | "expectedRevision">): string {
  return JSON.stringify([i.roomId, i.probabilityBps, i.reasoning, i.expectedRevision]);
}

// ---------------------------------------------------------------------------
// Public shapes (what the API returns; no session, nonce or auth data)

export type PublicForecast = {
  forecastId: string;
  roomId: string;
  wallet: string;
  probabilityBps: number;
  reasoning: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicRevision = {
  revision: number;
  probabilityBps: number;
  reasoning: string;
  createdAt: string;
};

const iso = (ms: number) => new Date(ms).toISOString();

export function serializeForecast(f: ForecastRecord): PublicForecast {
  return {
    forecastId: f.forecastId,
    roomId: f.roomId,
    wallet: f.wallet,
    probabilityBps: f.probabilityBps,
    reasoning: f.reasoning,
    revision: f.revision,
    createdAt: iso(f.createdAt),
    updatedAt: iso(f.updatedAt),
  };
}

export function serializeRevision(r: ForecastRevisionRecord): PublicRevision {
  return { revision: r.revision, probabilityBps: r.probabilityBps, reasoning: r.reasoning, createdAt: iso(r.createdAt) };
}

/** "62.5%"-style label (up to `decimals` places, trailing zeros dropped). */
export function formatBpsPercent(bps: number, decimals = 2): string {
  return `${Number((bps / 100).toFixed(Math.max(0, Math.min(2, decimals))))}%`;
}

/** Percent text (e.g. "62.5") → bps, or null when not a valid 0..100 value with ≤2 decimals. */
export function percentToBps(text: string): number | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(t)) return null;
  const bps = Math.round(Number(t) * 100);
  return bps >= BPS_MIN && bps <= BPS_MAX ? bps : null;
}
