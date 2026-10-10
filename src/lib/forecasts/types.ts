/**
 * Forecast persistence contract. Implemented by the same adapters as rooms
 * (SQLite file locally / self-hosted, Upstash Redis in serverless production,
 * "unavailable" when nothing durable is configured), so forecasts share the
 * rooms' durability and fail-closed behaviour.
 *
 * Guarantees every adapter must provide:
 *  - at most one CURRENT forecast per (roomId, wallet);
 *  - a revision is accepted only if `expectedRevision` equals the stored
 *    revision (0 = none yet), checked and applied atomically, so concurrent
 *    edits can't silently overwrite each other;
 *  - every accepted submission appends exactly one immutable history entry
 *    with revision = previous + 1 (UNIQUE (roomId, wallet, revision));
 *  - aggregate (participants, sum, histogram) reflects CURRENT forecasts only
 *    and is updated in the same atomic step;
 *  - idempotent submit keyed by (roomId, wallet, idempotencyKey).
 */

import type { ForecastAggregate, ForecastRecord, ForecastRevisionRecord } from "./domain";

export type SubmitForecastCommand = {
  roomId: string;
  wallet: string;
  probabilityBps: number;
  reasoning: string;
  expectedRevision: number;
  /** Server clock, unix ms. */
  now: number;
  /** Used only when this is the wallet's first forecast in the room. */
  newForecastId: string;
};

export type SubmitForecastResult = { status: "created" | "revised" | "replayed"; forecast: ForecastRecord };

export interface ForecastRepository {
  /**
   * Initial submit (expectedRevision 0) or revision (expectedRevision = current).
   * Throws ForecastRevisionConflictError on mismatch, IdempotencyConflictError
   * when the key was used for a different submission. Same key + same
   * fingerprint returns the original result ("replayed").
   */
  submitForecast(cmd: SubmitForecastCommand, idem: { key: string; fingerprint: string }): Promise<SubmitForecastResult>;
  getCurrentForecast(roomId: string, wallet: string): Promise<ForecastRecord | null>;
  /** Newest revision first, at most `limit`. */
  getForecastHistory(roomId: string, wallet: string, opts: { limit: number }): Promise<ForecastRevisionRecord[]>;
  /** Current forecasts, most recently updated first; bounded page + total count. */
  listCurrentForecasts(roomId: string, opts: { limit: number; offset: number }): Promise<{ items: ForecastRecord[]; total: number }>;
  getForecastAggregate(roomId: string): Promise<ForecastAggregate>;
  countForecastParticipants(roomId: string): Promise<number>;
}

export class ForecastRevisionConflictError extends Error {
  constructor(public currentRevision: number) {
    super(`forecast revision conflict (current revision ${currentRevision})`);
    this.name = "ForecastRevisionConflictError";
  }
}
