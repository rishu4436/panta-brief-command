import "server-only";

/**
 * Community forecasting application service: the only place forecasts are
 * written. Route handlers authenticate (verified SIWS session) and parse;
 * this checks the room, re-checks the market's forecast window against Panta
 * with the server clock, then persists atomically through the repository.
 */

import { createHash, randomBytes } from "node:crypto";
import type { RoomRecord } from "@/lib/rooms/domain";
import type { RoomRepository } from "@/lib/rooms/store/types";
import {
  HISTORY_LIMIT_MAX,
  consensusFrom,
  forecastRequestFingerprint,
  serializeForecast,
  serializeRevision,
  type Consensus,
  type PublicForecast,
  type PublicRevision,
  type SubmitForecastInput,
} from "./domain";
import type { ForecastWindow } from "./window";

export type ForecastWindowCheck = (marketId: string, nowMs: number) => Promise<ForecastWindow>;

export type ForecastServiceDeps = {
  repo: RoomRepository;
  /** Fresh check (writes). */
  checkWindow: ForecastWindowCheck;
  now: () => number;
  newId?: () => string;
};

export const newForecastId = () => `fc_${randomBytes(12).toString("hex")}`;

export class ForecastingClosedError extends Error {
  constructor(public window: Extract<ForecastWindow, { open: false }>) {
    super(window.message);
    this.name = "ForecastingClosedError";
  }
}

export class ForecastRoomMismatchError extends Error {
  constructor() {
    super("roomId does not match the room at this address");
    this.name = "ForecastRoomMismatchError";
  }
}

export function forecastRequestHash(input: SubmitForecastInput): string {
  return createHash("sha256").update(forecastRequestFingerprint(input)).digest("hex");
}

/**
 * Submit or revise the VERIFIED wallet's forecast (wallet from the session,
 * never the body). Nothing is written unless the room is active, the body's
 * roomId is this room, and Panta confirms the forecast window is open now.
 */
export async function submitForecast(
  deps: ForecastServiceDeps,
  wallet: string,
  room: RoomRecord,
  input: SubmitForecastInput,
): Promise<{ status: "created" | "revised" | "replayed"; forecast: PublicForecast }> {
  if (input.roomId !== room.roomId) throw new ForecastRoomMismatchError();
  const now = deps.now();
  const window = await deps.checkWindow(room.marketId, now);
  if (!window.open) throw new ForecastingClosedError(window);
  const res = await deps.repo.submitForecast(
    {
      roomId: room.roomId,
      wallet,
      probabilityBps: input.probabilityBps,
      reasoning: input.reasoning,
      expectedRevision: input.expectedRevision,
      now: deps.now(),
      newForecastId: (deps.newId ?? newForecastId)(),
    },
    { key: input.idempotencyKey, fingerprint: forecastRequestHash(input) },
  );
  return { status: res.status, forecast: serializeForecast(res.forecast) };
}

export type RoomForecastSummary = {
  consensus: Consensus;
  forecasts: PublicForecast[];
  total: number;
  limit: number;
  offset: number;
};

export async function roomForecastSummary(
  repo: RoomRepository,
  roomId: string,
  page: { limit: number; offset: number },
): Promise<RoomForecastSummary> {
  const [aggregate, list] = await Promise.all([repo.getForecastAggregate(roomId), repo.listCurrentForecasts(roomId, page)]);
  return { consensus: consensusFrom(aggregate), forecasts: list.items.map(serializeForecast), total: list.total, ...page };
}

export async function walletForecast(
  repo: RoomRepository,
  roomId: string,
  wallet: string,
  historyLimit = HISTORY_LIMIT_MAX,
): Promise<{ current: PublicForecast | null; history: PublicRevision[] }> {
  const [current, history] = await Promise.all([
    repo.getCurrentForecast(roomId, wallet),
    repo.getForecastHistory(roomId, wallet, { limit: Math.min(historyLimit, HISTORY_LIMIT_MAX) }),
  ]);
  return { current: current ? serializeForecast(current) : null, history: history.map(serializeRevision) };
}
