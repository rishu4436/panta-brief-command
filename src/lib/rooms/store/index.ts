import "server-only";

/**
 * Which durable backend serves Prediction Rooms (see docs/PREDICTION_ROOMS.md):
 *
 *  1. Upstash Redis when UPSTASH_REDIS_REST_URL/_TOKEN (or KV_REST_API_*) are
 *     set: shared + durable, the production backend.
 *  2. On Vercel without Redis: UNAVAILABLE. Instances have no durable shared
 *     disk, so a SQLite file there would silently lose rooms. Reads answer
 *     503 and creation fails closed with a clear message.
 *  3. ROOMS_SQLITE_PATH set (self-hosted / local `next start`): SQLite file.
 *  4. Development (NODE_ENV !== "production"): SQLite at .data/rooms.sqlite.
 *  5. Anything else in production: UNAVAILABLE (never an ephemeral store).
 */

import path from "node:path";
import { sharedStoreCredentials } from "@/lib/shared-store";
import { RedisRoomRepository, upstashRedisLike } from "./redis";
import { SqliteRoomRepository } from "./sqlite";
import { RoomStoreUnavailableError, type RoomRepository } from "./types";

export type RoomStoreConfig =
  | { kind: "redis"; url: string; token: string }
  | { kind: "sqlite"; file: string }
  | { kind: "unavailable"; reason: string };

export const DEFAULT_SQLITE_PATH = path.join(".data", "rooms.sqlite");

export const UNCONFIGURED_MESSAGE =
  "Prediction Rooms storage isn't configured on this deployment, so rooms can't be created or listed here yet.";

export function resolveRoomStoreConfig(env: Record<string, string | undefined> = process.env): RoomStoreConfig {
  const creds = sharedStoreCredentials(env);
  if (creds) return { kind: "redis", ...creds };
  if ((env.VERCEL || "").trim()) {
    return { kind: "unavailable", reason: "Vercel has no durable shared disk; set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN." };
  }
  const explicit = (env.ROOMS_SQLITE_PATH || "").trim();
  if (explicit) return { kind: "sqlite", file: path.resolve(explicit) };
  if (env.NODE_ENV !== "production") return { kind: "sqlite", file: path.resolve(DEFAULT_SQLITE_PATH) };
  return { kind: "unavailable", reason: "Production without UPSTASH_REDIS_REST_* or ROOMS_SQLITE_PATH." };
}

class UnavailableRoomRepository implements RoomRepository {
  readonly kind = "unavailable" as const;
  readonly durable = false;
  constructor(readonly reason: string) {}
  private fail(): never {
    throw new RoomStoreUnavailableError("unconfigured", this.reason);
  }
  createRoom = async (): Promise<never> => this.fail();
  getRoomById = async (): Promise<never> => this.fail();
  getRoomBySlug = async (): Promise<never> => this.fail();
  listPublicRooms = async (): Promise<never> => this.fail();
  listRoomsByCreator = async (): Promise<never> => this.fail();
  isSlugTaken = async (): Promise<never> => this.fail();
  updateRoom = async (): Promise<never> => this.fail();
  saveChallenge = async (): Promise<never> => this.fail();
  consumeChallenge = async (): Promise<never> => this.fail();
}

export function createRoomRepository(cfg: RoomStoreConfig): RoomRepository {
  if (cfg.kind === "redis") return new RedisRoomRepository(upstashRedisLike(cfg.url, cfg.token));
  if (cfg.kind === "sqlite") return new SqliteRoomRepository(cfg.file);
  return new UnavailableRoomRepository(cfg.reason);
}

let override: RoomRepository | undefined;
let fromEnv: RoomRepository | undefined;
let warned = false;

export function roomRepository(): RoomRepository {
  if (override) return override;
  if (!fromEnv) {
    const cfg = resolveRoomStoreConfig();
    if (cfg.kind === "unavailable" && !warned) {
      warned = true;
      console.warn(`[rooms] ${UNCONFIGURED_MESSAGE} ${cfg.reason}`);
    }
    fromEnv = createRoomRepository(cfg);
  }
  return fromEnv;
}

/** Tests only: inject a repository (undefined restores env selection). */
export function __setRoomRepositoryForTests(repo: RoomRepository | undefined) {
  override = repo;
  fromEnv = undefined;
}

export * from "./types";
