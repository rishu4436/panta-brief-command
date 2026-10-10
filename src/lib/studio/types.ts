/**
 * Creator Growth Studio persistence contract (implemented by the room
 * adapters, SQLite and Upstash Redis, so Studio data shares their durability
 * and fail-closed selection). See docs/CREATOR_STUDIO.md.
 *
 * Guarantees every adapter must provide:
 *  - creator room listings include archived rooms and are bounded;
 *  - participation stats are derived from durable forecast records (SQLite: by
 *    indexed joins; Redis: per-creator indexes maintained after each forecast
 *    write plus a one-time bounded backfill), with identical definitions;
 *  - distribution counters are per (creator, UTC day, room, metric), retained
 *    ANALYTICS_RETENTION_DAYS, capped per day and per room, and a duplicate
 *    dedupe key never increments anything.
 */

import type { RoomRecord } from "@/lib/rooms/domain";

export type CreatorStats = {
  uniqueForecasters: number;
  returningForecasters: number;
  /** roomId → total saved revisions (all versions, including first). */
  revisionsByRoom: Record<string, number>;
  /** First-forecast times (ms) of wallets new to this creator at or after `sinceMs`, ascending, at most `maxFirst`. */
  firstForecastTimes: number[];
  /** True when a maintained index was rebuilt from a capped scan (Redis). */
  approximate: boolean;
};

export type CounterRow = { day: string; roomId: string; metric: string; count: number };

export type RecordEventCommand = {
  creatorWallet: string;
  roomId: string;
  /** UTC day `YYYY-MM-DD` from the server clock. */
  day: string;
  /** Counter metrics this event increments (see METRIC in domain.ts). */
  metrics: string[];
  /** HMAC dedupe key (never a raw IP); a repeat within DEDUPE_TTL_MS counts nothing. */
  dedupeKey: string;
  nowMs: number;
};

export type RecordEventResult = "counted" | "duplicate" | "capped";

export type CreatorActivity = {
  creatorWallet: string;
  roomId: string;
  wallet: string;
  kind: "created" | "revised";
  /** The forecast's first-revision time in this room. */
  firstAt: number;
};

export interface StudioRepository {
  /** All of the creator's rooms (any status/visibility), newest first. */
  listCreatorRoomsAll(wallet: string, opts: { limit: number }): Promise<RoomRecord[]>;
  getCreatorStats(wallet: string, opts: { rooms: RoomRecord[]; sinceMs: number; maxFirst: number }): Promise<CreatorStats>;
  /** After a forecast write (created/revised): maintain per-creator indexes (Redis); SQLite derives by join. */
  noteCreatorActivity(a: CreatorActivity): Promise<void>;
  /** Challenges stored for the room's retained debates. */
  countRoomChallenges(roomId: string): Promise<number>;
  recordStudioEvent(cmd: RecordEventCommand): Promise<RecordEventResult>;
  /** Counters for the given UTC days (bounded by the caller). */
  listStudioCounters(wallet: string, opts: { days: string[] }): Promise<CounterRow[]>;
}
