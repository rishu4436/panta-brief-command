import "server-only";

/**
 * Prediction Rooms application service: the only place rooms are created or
 * changed. Route handlers parse + authenticate; this validates the market
 * against Panta (never trusting browser metadata) and persists through the
 * repository. Dependencies are injectable for tests.
 */

import { createHash, randomBytes } from "node:crypto";
import { marketLifecycle } from "@/lib/panta/catalog";
import type { Market } from "@/lib/panta/domain";
import { getMarketServer, UpstreamError } from "@/lib/panta/server";
import {
  createRequestFingerprint,
  serializeRoom,
  type CreateRoomInput,
  type Room,
  type UpdateRoomInput,
} from "./domain";
import type { RoomRepository } from "./store/types";

export type MarketCheck =
  | { ok: true; marketId: string }
  | { ok: false; code: "MARKET_NOT_FOUND" | "MARKET_CANCELLED" | "MARKET_VALIDATION_UNAVAILABLE"; message: string };

export type MarketValidator = (marketId: string) => Promise<MarketCheck>;

export const MARKET_CHECK_TEXT = {
  MARKET_NOT_FOUND: "Panta has no market with this id. Pick a market from the list.",
  MARKET_CANCELLED: "Panta cancelled this market, so a room can't be attached to it.",
  MARKET_VALIDATION_UNAVAILABLE: "Panta couldn't be reached to confirm this market. Nothing was saved. Try again.",
} as const;

/** Pure decision over a Panta detail lookup (exported for tests). */
export function checkPantaMarket(requestedId: string, market: Market | null): MarketCheck {
  if (!market || market.marketId !== requestedId) {
    return { ok: false, code: "MARKET_NOT_FOUND", message: MARKET_CHECK_TEXT.MARKET_NOT_FOUND };
  }
  if (marketLifecycle(market) === "cancelled") {
    return { ok: false, code: "MARKET_CANCELLED", message: MARKET_CHECK_TEXT.MARKET_CANCELLED };
  }
  return { ok: true, marketId: market.marketId };
}

/** Server-side market validation against the Panta detail endpoint (server key). */
export const validatePantaMarket: MarketValidator = async (marketId) => {
  try {
    return checkPantaMarket(marketId, await getMarketServer(marketId));
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 404) {
      return { ok: false, code: "MARKET_NOT_FOUND", message: MARKET_CHECK_TEXT.MARKET_NOT_FOUND };
    }
    return { ok: false, code: "MARKET_VALIDATION_UNAVAILABLE", message: MARKET_CHECK_TEXT.MARKET_VALIDATION_UNAVAILABLE };
  }
};

export const newRoomId = () => `room_${randomBytes(12).toString("hex")}`;

export type RoomServiceDeps = {
  repo: RoomRepository;
  validateMarket: MarketValidator;
  now: () => number;
  newId?: () => string;
};

export class MarketRejectedError extends Error {
  constructor(public check: Extract<MarketCheck, { ok: false }>) {
    super(check.message);
    this.name = "MarketRejectedError";
  }
}

export function requestHash(input: CreateRoomInput): string {
  return createHash("sha256").update(createRequestFingerprint(input)).digest("hex");
}

/**
 * Create a room for a VERIFIED wallet (from the session, never the body).
 * Order: the market is validated against Panta, then the repository inserts
 * atomically (slug UNIQUE) or replays the original room for the same
 * idempotency key + payload. Nothing is written when validation fails.
 */
export async function createRoom(
  deps: RoomServiceDeps,
  creatorWallet: string,
  input: CreateRoomInput,
): Promise<{ status: "created" | "replayed"; room: Room }> {
  const fingerprint = requestHash(input);
  const check = await deps.validateMarket(input.marketId);
  if (!check.ok) throw new MarketRejectedError(check);
  const res = await deps.repo.createRoom(
    {
      roomId: (deps.newId ?? newRoomId)(),
      slug: input.slug,
      title: input.title,
      description: input.description,
      creatorWallet,
      marketId: check.marketId,
      visibility: input.visibility,
      createdAt: deps.now(),
    },
    { key: input.idempotencyKey, fingerprint },
  );
  return { status: res.status, room: serializeRoom(res.room) };
}

export async function updateRoomDetails(
  deps: Pick<RoomServiceDeps, "repo" | "now">,
  actorWallet: string,
  roomId: string,
  patch: UpdateRoomInput,
): Promise<Room> {
  return serializeRoom(await deps.repo.updateRoom(roomId, actorWallet, patch, deps.now()));
}

export async function getRoomBySlug(repo: RoomRepository, slug: string): Promise<Room | null> {
  const r = await repo.getRoomBySlug(slug);
  return r ? serializeRoom(r) : null;
}

export async function listPublicRooms(repo: RoomRepository, limit: number): Promise<Room[]> {
  return (await repo.listPublicRooms({ limit })).map(serializeRoom);
}

export async function listCreatorRooms(
  repo: RoomRepository,
  wallet: string,
  opts: { limit: number; includeUnlisted: boolean },
): Promise<Room[]> {
  return (await repo.listRoomsByCreator(wallet, opts)).map(serializeRoom);
}
