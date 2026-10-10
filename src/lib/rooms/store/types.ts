/**
 * Room persistence contract. Adapters (SQLite file for local dev, Upstash
 * Redis for serverless production, "unavailable" when nothing durable is
 * configured) all implement this one interface, so the service and routes
 * never know which backend they talk to.
 *
 * Guarantees every adapter must provide:
 *  - slug uniqueness enforced atomically by the backend (UNIQUE / SET NX);
 *  - idempotent create keyed by (creatorWallet, idempotencyKey);
 *  - single-use auth challenges (consume is atomic: delete-and-return);
 *  - updates only by the room's creator.
 * Forecasts (lib/forecasts/types.ts) live in the same backend so they share
 * its durability and fail-closed selection.
 */

import type { ArenaRepository } from "@/lib/arena/types";
import type { ForecastRepository } from "@/lib/forecasts/types";
import type { RoomRecord, RoomStatus, RoomVisibility } from "../domain";

export { ForecastRevisionConflictError } from "@/lib/forecasts/types";

export type RoomStoreKind = "sqlite" | "redis" | "unavailable";

export type AuthChallengeRecord = {
  nonce: string;
  wallet: string;
  /** Exact text the wallet signs (UTF-8). */
  message: string;
  /** Host the message is bound to (e.g. briefcommand.vercel.app). */
  domain: string;
  issuedAt: number;
  expiresAt: number;
};

export type NewRoom = Omit<RoomRecord, "status" | "updatedAt"> & { status?: RoomStatus };

export type CreateRoomResult = { status: "created" | "replayed"; room: RoomRecord };

export type ListOptions = { limit: number };

export interface RoomRepository extends ForecastRepository, ArenaRepository {
  readonly kind: RoomStoreKind;
  /** Durable across restarts and shared across server instances. */
  readonly durable: boolean;

  /**
   * Insert a room. Throws SlugTakenError when the slug exists,
   * IdempotencyConflictError when the key was used for a different payload.
   * Same key + same fingerprint returns the original room ("replayed").
   */
  createRoom(room: NewRoom, idem: { key: string; fingerprint: string }): Promise<CreateRoomResult>;
  getRoomById(roomId: string): Promise<RoomRecord | null>;
  getRoomBySlug(slug: string): Promise<RoomRecord | null>;
  /** Public + active rooms, newest first. */
  listPublicRooms(opts: ListOptions): Promise<RoomRecord[]>;
  /** A creator's rooms, newest first; unlisted only when asked (owner view). */
  listRoomsByCreator(wallet: string, opts: ListOptions & { includeUnlisted: boolean }): Promise<RoomRecord[]>;
  isSlugTaken(slug: string): Promise<boolean>;
  /** Throws RoomNotFoundError / RoomForbiddenError. */
  updateRoom(
    roomId: string,
    actorWallet: string,
    patch: { title?: string; description?: string },
    now: number,
  ): Promise<RoomRecord>;

  saveChallenge(c: AuthChallengeRecord): Promise<void>;
  /** Atomically remove and return the challenge (null if unknown or already used). */
  consumeChallenge(nonce: string): Promise<AuthChallengeRecord | null>;
}

export class SlugTakenError extends Error {
  constructor(public slug: string) {
    super(`slug taken: ${slug}`);
    this.name = "SlugTakenError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key reused with a different request");
    this.name = "IdempotencyConflictError";
  }
}

/** A create with this idempotency key was claimed but its room isn't written (yet). */
export class CreateInProgressError extends Error {
  constructor() {
    super("a create with this idempotency key is still in progress");
    this.name = "CreateInProgressError";
  }
}

export class RoomNotFoundError extends Error {
  constructor() {
    super("room not found");
    this.name = "RoomNotFoundError";
  }
}

export class RoomForbiddenError extends Error {
  constructor() {
    super("only the room creator can change this room");
    this.name = "RoomForbiddenError";
  }
}

/** No durable backend configured (production without DB) or backend unreachable. */
export class RoomStoreUnavailableError extends Error {
  constructor(
    public reason: "unconfigured" | "failure",
    detail?: string,
  ) {
    super(detail || (reason === "unconfigured" ? "no durable room store configured" : "room store failure"));
    this.name = "RoomStoreUnavailableError";
  }
}

export const isVisibility = (v: string): v is RoomVisibility => v === "public" || v === "unlisted";
