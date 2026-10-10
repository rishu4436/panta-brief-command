/**
 * Phase 1 — Prediction Rooms foundation.
 * Domain validation, both repository adapters (shared contract), wallet
 * sign-in (Ed25519 challenge), service rules and the HTTP route handlers.
 * Wallet keys here are generated per test run: legitimate test auth, never
 * a product state.
 */
import { generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { NextRequest } from "next/server";
import { createSignInMessageText, parseSignInMessageText } from "@solana/wallet-standard-util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Market } from "@/lib/panta/domain";
import { marketState } from "@/lib/panta/lifecycle";
import {
  CreateRoomInput,
  DESCRIPTION_MAX,
  RESERVED_SLUGS,
  ROOM_ID_RE,
  UpdateRoomInput,
  cleanLine,
  serializeRoom,
  slugify,
  slugProblem,
} from "@/lib/rooms/domain";
import {
  AUTH_PURPOSE,
  AUTH_STATEMENT,
  CHALLENGE_TTL_MS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  buildChallengeMessage,
  decodeWallet,
  issueChallenge,
  readSession,
  sessionSecret,
  signSession,
  verifyChallenge,
  verifyEd25519,
} from "@/lib/rooms/auth";
import { roomMarketCta, roomMarketPrice, roomMarketTiming } from "@/lib/rooms/market-context";
import {
  MarketRejectedError,
  checkPantaMarket,
  createRoom,
  newRoomId,
  type MarketValidator,
} from "@/lib/rooms/service";
import { SqliteRoomRepository } from "@/lib/rooms/store/sqlite";
import { RedisRoomRepository } from "@/lib/rooms/store/redis";
import { FakeRedis } from "./helpers/fake-redis";
import { isolatedRedisBackends } from "./helpers/isolated-redis";
import {
  __setRoomRepositoryForTests,
  createRoomRepository,
  resolveRoomStoreConfig,
} from "@/lib/rooms/store";
import {
  IdempotencyConflictError,
  RoomForbiddenError,
  RoomStoreUnavailableError,
  SlugTakenError,
  type RoomRepository,
} from "@/lib/rooms/store/types";
import { __setRoomDepsForTests } from "@/lib/rooms/deps";

// ---------------------------------------------------------------- helpers

const MARKET_A = "EAcFbWUcxgJ6yK4tqqgB8sCZ2bYzPZb6Yy6fN9GZ3nQv";
const MARKET_B = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

function wallet(): { address: string; priv: KeyObject; signText: (m: string) => string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  return {
    address: bs58.encode(raw),
    priv: privateKey,
    signText: (m) => bs58.encode(edSign(null, Buffer.from(m, "utf8"), privateKey)),
  };
}

let tmpDirs: string[] = [];
function tmpDbFile(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "rooms-test-"));
  tmpDirs.push(d);
  return path.join(d, "rooms.sqlite");
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

const idem = (n = 0) => ({ key: `idem-key-${String(n).padStart(8, "0")}`, fingerprint: `fp-${n}` });

function newRoom(over: Partial<{ slug: string; creatorWallet: string; visibility: "public" | "unlisted"; createdAt: number; marketId: string }> = {}) {
  return {
    roomId: newRoomId(),
    slug: over.slug ?? `room-${Math.random().toString(36).slice(2, 8)}`,
    title: "Will it happen?",
    description: "A room for the market.",
    creatorWallet: over.creatorWallet ?? wallet().address,
    marketId: over.marketId ?? MARKET_A,
    visibility: over.visibility ?? ("public" as const),
    createdAt: over.createdAt ?? Date.now(),
  };
}

// ---------------------------------------------------------------- 1. domain

describe("room domain validation", () => {
  const base = { title: "  Belgium vs France  ", description: "Talk it through.", slug: "belgium-france", marketId: MARKET_A, idempotencyKey: "abcdefghijklmnop" };

  it("normalises a valid create input", () => {
    const p = CreateRoomInput.parse(base);
    expect(p.title).toBe("Belgium vs France");
    expect(p.visibility).toBe("public");
    expect(p.marketId).toBe(MARKET_A);
  });

  it("rejects client-supplied creator identity (strict schema)", () => {
    const r = CreateRoomInput.safeParse({ ...base, creatorWallet: wallet().address });
    expect(r.success).toBe(false);
  });

  it("rejects bad titles, long descriptions, bad market ids and bad keys", () => {
    expect(CreateRoomInput.safeParse({ ...base, title: "ab" }).success).toBe(false);
    expect(CreateRoomInput.safeParse({ ...base, title: "x".repeat(81) }).success).toBe(false);
    expect(CreateRoomInput.safeParse({ ...base, description: "d".repeat(DESCRIPTION_MAX + 1) }).success).toBe(false);
    expect(CreateRoomInput.safeParse({ ...base, marketId: "not-a-market" }).success).toBe(false);
    expect(CreateRoomInput.safeParse({ ...base, marketId: "0OIl".repeat(10) }).success).toBe(false);
    expect(CreateRoomInput.safeParse({ ...base, idempotencyKey: "short" }).success).toBe(false);
    expect(CreateRoomInput.safeParse({ ...base, visibility: "private" }).success).toBe(false);
  });

  it("strips control / bidi characters and collapses whitespace", () => {
    expect(cleanLine("a\u202Eb\u0000c   d\n e")).toBe("abc d e");
  });

  it("slugs: proposal, format rules and reserved names", () => {
    expect(slugify("Will BTC close above $100k? (Oct)")).toBe("will-btc-close-above-100k-oct");
    expect(slugify("Café à Paris")).toBe("cafe-a-paris");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(48);
    expect(slugProblem("ok-slug")).toBeNull();
    expect(slugProblem("ab")).toBe("too_short");
    expect(slugProblem("-bad")).toBe("format");
    expect(slugProblem("bad--slug")).toBe("format");
    expect(slugProblem("Upper")).toBe("format");
    expect(slugProblem("create")).toBe("reserved");
    expect(RESERVED_SLUGS.has("slug-check")).toBe(true);
    expect(CreateRoomInput.safeParse({ ...base, slug: "create" }).success).toBe(false);
  });

  it("update input needs a field and rejects unknown keys", () => {
    expect(UpdateRoomInput.safeParse({}).success).toBe(false);
    expect(UpdateRoomInput.safeParse({ title: "New title" }).success).toBe(true);
    expect(UpdateRoomInput.safeParse({ title: "New title", creatorWallet: "x" }).success).toBe(false);
    expect(UpdateRoomInput.safeParse({ marketId: MARKET_B }).success).toBe(false);
  });

  it("serialises without copying any market data", () => {
    const r = serializeRoom({ ...newRoom(), status: "active", updatedAt: 0, createdAt: 0 });
    expect(Object.keys(r).sort()).toEqual(
      ["createdAt", "creatorWallet", "description", "marketId", "roomId", "schemaVersion", "slug", "status", "title", "updatedAt", "visibility"].sort(),
    );
    expect(ROOM_ID_RE.test(r.roomId)).toBe(true);
  });
});

// ---------------------------------------------------------------- 2. repository contract (both adapters)

const adapters: [string, () => { repo: RoomRepository; reopen: () => RoomRepository; fake?: FakeRedis }][] = [
  [
    "sqlite",
    () => {
      const file = tmpDbFile();
      return { repo: new SqliteRoomRepository(file), reopen: () => new SqliteRoomRepository(file) };
    },
  ],
  [
    "redis (fake)",
    () => {
      const fake = new FakeRedis();
      return { repo: new RedisRoomRepository(fake), reopen: () => new RedisRoomRepository(fake), fake };
    },
  ],
  ...isolatedRedisBackends().map((b): (typeof adapters)[number] => [b.name, () => b.open()]),
];

describe.each(adapters)("room repository contract: %s", (_name, make) => {
  it("creates and reads by id and slug", async () => {
    const { repo } = make();
    const input = newRoom({ slug: "first-room" });
    const res = await repo.createRoom(input, idem(1));
    expect(res.status).toBe("created");
    expect((await repo.getRoomById(input.roomId))?.slug).toBe("first-room");
    expect((await repo.getRoomBySlug("first-room"))?.roomId).toBe(input.roomId);
    expect(await repo.getRoomBySlug("missing-room")).toBeNull();
    expect(await repo.isSlugTaken("first-room")).toBe(true);
    expect(await repo.isSlugTaken("other-room")).toBe(false);
  });

  it("persists across a new repository instance (restart)", async () => {
    const { repo, reopen } = make();
    const input = newRoom({ slug: "survives-restart" });
    await repo.createRoom(input, idem(2));
    const again = reopen();
    expect((await again.getRoomBySlug("survives-restart"))?.roomId).toBe(input.roomId);
  });

  it("rejects a duplicate slug (different creator, different key)", async () => {
    const { repo } = make();
    await repo.createRoom(newRoom({ slug: "taken-slug" }), idem(3));
    await expect(repo.createRoom(newRoom({ slug: "taken-slug" }), idem(4))).rejects.toBeInstanceOf(SlugTakenError);
  });

  it("concurrent creates of one slug: exactly one wins", async () => {
    const { repo } = make();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => repo.createRoom(newRoom({ slug: "race-slug" }), idem(100 + i))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof SlugTakenError)).toHaveLength(5);
  });

  it("idempotency: same key + same payload replays the same room; different payload conflicts", async () => {
    const { repo } = make();
    const creator = wallet().address;
    const first = newRoom({ slug: "idem-room", creatorWallet: creator });
    const a = await repo.createRoom(first, idem(5));
    const b = await repo.createRoom({ ...first, roomId: newRoomId() }, idem(5));
    expect(b.status).toBe("replayed");
    expect(b.room.roomId).toBe(a.room.roomId);
    await expect(repo.createRoom(newRoom({ slug: "idem-room-2", creatorWallet: creator }), { key: idem(5).key, fingerprint: "other" })).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect((await repo.listRoomsByCreator(creator, { limit: 10, includeUnlisted: true })).length).toBe(1);
  });

  it("lists public rooms newest first; unlisted only for the owner view", async () => {
    const { repo } = make();
    const creator = wallet().address;
    await repo.createRoom(newRoom({ slug: "older-room", creatorWallet: creator, createdAt: 1_000 }), idem(6));
    await repo.createRoom(newRoom({ slug: "newer-room", creatorWallet: creator, createdAt: 2_000 }), idem(7));
    await repo.createRoom(newRoom({ slug: "hidden-room", creatorWallet: creator, createdAt: 3_000, visibility: "unlisted" }), idem(8));
    expect((await repo.listPublicRooms({ limit: 10 })).map((r) => r.slug)).toEqual(["newer-room", "older-room"]);
    expect((await repo.listRoomsByCreator(creator, { limit: 10, includeUnlisted: false })).map((r) => r.slug)).toEqual(["newer-room", "older-room"]);
    expect((await repo.listRoomsByCreator(creator, { limit: 10, includeUnlisted: true })).map((r) => r.slug)).toEqual([
      "hidden-room",
      "newer-room",
      "older-room",
    ]);
    expect(await repo.getRoomBySlug("hidden-room")).not.toBeNull();
  });

  it("only the creator can update; the market reference never changes", async () => {
    const { repo } = make();
    const creator = wallet().address;
    const input = newRoom({ slug: "edit-room", creatorWallet: creator });
    await repo.createRoom(input, idem(9));
    await expect(repo.updateRoom(input.roomId, wallet().address, { title: "Hijack" }, Date.now())).rejects.toBeInstanceOf(RoomForbiddenError);
    const next = await repo.updateRoom(input.roomId, creator, { title: "Renamed room" }, input.createdAt + 5);
    expect(next.title).toBe("Renamed room");
    expect(next.marketId).toBe(MARKET_A);
    expect((await repo.getRoomBySlug("edit-room"))?.title).toBe("Renamed room");
  });

  it("challenges are single use", async () => {
    const { repo } = make();
    const c = { nonce: "a".repeat(32), wallet: wallet().address, message: "m", domain: "localhost", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 };
    await repo.saveChallenge(c);
    expect((await repo.consumeChallenge(c.nonce))?.wallet).toBe(c.wallet);
    expect(await repo.consumeChallenge(c.nonce)).toBeNull();
  });
});

describe("redis adapter failure handling", () => {
  it("a failed room write releases the slug + idempotency claims and reports unavailable", async () => {
    const fake = new FakeRedis();
    const repo = new RedisRoomRepository(fake);
    fake.failMulti = true;
    await expect(repo.createRoom(newRoom({ slug: "flaky-room" }), idem(1))).rejects.toBeInstanceOf(RoomStoreUnavailableError);
    expect(await repo.isSlugTaken("flaky-room")).toBe(false);
    fake.failMulti = false;
    expect((await repo.createRoom(newRoom({ slug: "flaky-room" }), idem(1))).status).toBe("created");
  });
});

// ---------------------------------------------------------------- 3. store selection (fail closed)

describe("room store selection", () => {
  it("uses Redis when Upstash credentials are configured", () => {
    expect(resolveRoomStoreConfig({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", NODE_ENV: "production", VERCEL: "1", VERCEL_URL: "briefcommand-test.vercel.app" }).kind).toBe("redis");
  });
  it("never uses SQLite on Vercel, and production without a durable store is unavailable", () => {
    expect(resolveRoomStoreConfig({ VERCEL: "1", NODE_ENV: "production", ROOMS_SQLITE_PATH: "/tmp/x.sqlite" }).kind).toBe("unavailable");
    expect(resolveRoomStoreConfig({ NODE_ENV: "production" }).kind).toBe("unavailable");
  });
  it("development defaults to the local SQLite file; explicit path works for self-hosting", () => {
    const dev = resolveRoomStoreConfig({ NODE_ENV: "development" });
    expect(dev.kind === "sqlite" && dev.file.endsWith(path.join(".data", "rooms.sqlite"))).toBe(true);
    expect(resolveRoomStoreConfig({ NODE_ENV: "production", ROOMS_SQLITE_PATH: "/srv/rooms.sqlite" }).kind).toBe("sqlite");
  });
  it("the unavailable store rejects every operation", async () => {
    const repo = createRoomRepository({ kind: "unavailable", reason: "test" });
    await expect(repo.listPublicRooms({ limit: 1 })).rejects.toBeInstanceOf(RoomStoreUnavailableError);
    await expect(repo.createRoom(newRoom(), idem())).rejects.toBeInstanceOf(RoomStoreUnavailableError);
  });
});

// ---------------------------------------------------------------- 4. wallet sign-in

describe("wallet ownership challenge", () => {
  const origin = "https://briefcommand.vercel.app";
  let repo: RoomRepository;
  beforeEach(() => {
    repo = new SqliteRoomRepository(tmpDbFile());
  });

  it("message binds domain, wallet, nonce, purpose and expiry", async () => {
    const w = wallet();
    const c = await issueChallenge(repo, { wallet: w.address, origin, now: 1_700_000_000_000 });
    expect(c.message).toBe(
      buildChallengeMessage({ domain: "briefcommand.vercel.app", uri: origin, wallet: w.address, nonce: c.nonce, issuedAt: c.issuedAt, expiresAt: c.expiresAt }),
    );
    expect(c.message).toContain("briefcommand.vercel.app wants you to sign in");
    expect(c.message).toContain("not a transaction");
    expect(c.message).toContain(`Nonce: ${c.nonce}`);
    expect(c.message).toContain("Request ID: prediction-rooms-auth");
    expect(c.message).not.toContain("Purpose:");
    expect(c.expiresAt - c.issuedAt).toBe(CHALLENGE_TTL_MS);
    expect(c.nonce).toMatch(/^[a-f0-9]{32}$/);
  });

  it("is a strictly standard SIWS message (parsed by @solana/wallet-standard-util, no extra fields)", async () => {
    const w = wallet();
    const c = await issueChallenge(repo, { wallet: w.address, origin: "http://localhost:3100", now: Date.UTC(2026, 9, 10, 9, 15, 30, 789) });
    const parsed = parseSignInMessageText(c.message);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({
      domain: "localhost:3100",
      address: w.address,
      statement: AUTH_STATEMENT,
      uri: "http://localhost:3100",
      version: "1",
      chainId: "mainnet",
      nonce: c.nonce,
      issuedAt: "2026-10-10T09:15:30Z",
      expirationTime: "2026-10-10T09:20:30Z",
      notBefore: undefined,
      requestId: AUTH_PURPOSE,
      resources: undefined,
    });
    // Canonical re-serialisation by the reference implementation is byte-identical.
    expect(createSignInMessageText(parsed!)).toBe(c.message);
    // Only standard field labels, in standard order.
    const labels = c.message.split("\n").slice(5).map((l) => l.split(": ")[0]);
    expect(labels).toEqual(["URI", "Version", "Chain ID", "Nonce", "Issued At", "Expiration Time", "Request ID"]);
    expect(AUTH_STATEMENT).not.toMatch(/\n/);
    expect(c.nonce).toMatch(/^[A-Za-z0-9]{8,}$/);
    expect(parsed!.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(new Date(parsed!.expirationTime!).getTime()).toBe(c.expiresAt);
  });

  it("a stored challenge whose text was altered is rejected even with a valid signature over it", async () => {
    const w = wallet();
    const now = Date.now();
    const c = await issueChallenge(repo, { wallet: w.address, origin, now });
    const forged = { ...c, nonce: "b".repeat(32), message: c.message.replace("Request ID: prediction-rooms-auth", "Request ID: something-else") };
    await repo.saveChallenge(forged);
    await expect(
      verifyChallenge(repo, { nonce: forged.nonce, signature: w.signText(forged.message), originHost: "briefcommand.vercel.app", now }),
    ).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  });

  it("rejects invalid wallet addresses", async () => {
    await expect(issueChallenge(repo, { wallet: "nope", origin, now: Date.now() })).rejects.toMatchObject({ code: "INVALID_WALLET" });
    expect(decodeWallet("z".repeat(44))).toBeNull();
    expect(decodeWallet("0OIl".repeat(10))).toBeNull();
  });

  it("valid signature → verified wallet from the stored challenge", async () => {
    const w = wallet();
    const now = Date.now();
    const c = await issueChallenge(repo, { wallet: w.address, origin, now });
    const res = await verifyChallenge(repo, { nonce: c.nonce, signature: w.signText(c.message), originHost: "briefcommand.vercel.app", now: now + 1_000 });
    expect(res.wallet).toBe(w.address);
  });

  it("invalid signature (other key, or tampered message) is rejected", async () => {
    const w = wallet();
    const attacker = wallet();
    const now = Date.now();
    const c1 = await issueChallenge(repo, { wallet: w.address, origin, now });
    await expect(
      verifyChallenge(repo, { nonce: c1.nonce, signature: attacker.signText(c1.message), originHost: "briefcommand.vercel.app", now }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    const c2 = await issueChallenge(repo, { wallet: w.address, origin, now });
    await expect(
      verifyChallenge(repo, { nonce: c2.nonce, signature: w.signText(c2.message + " "), originHost: "briefcommand.vercel.app", now }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    const c3 = await issueChallenge(repo, { wallet: w.address, origin, now });
    await expect(verifyChallenge(repo, { nonce: c3.nonce, signature: "garbage!", originHost: "briefcommand.vercel.app", now })).rejects.toMatchObject({
      code: "INVALID_SIGNATURE_FORMAT",
    });
  });

  it("expired challenge is rejected", async () => {
    const w = wallet();
    const now = Date.now();
    const c = await issueChallenge(repo, { wallet: w.address, origin, now });
    await expect(
      verifyChallenge(repo, { nonce: c.nonce, signature: w.signText(c.message), originHost: "briefcommand.vercel.app", now: now + CHALLENGE_TTL_MS + 1 }),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });

  it("replayed challenge is rejected (nonce consumed on first use, even when that use failed)", async () => {
    const w = wallet();
    const now = Date.now();
    const c = await issueChallenge(repo, { wallet: w.address, origin, now });
    const sig = w.signText(c.message);
    await verifyChallenge(repo, { nonce: c.nonce, signature: sig, originHost: "briefcommand.vercel.app", now });
    await expect(verifyChallenge(repo, { nonce: c.nonce, signature: sig, originHost: "briefcommand.vercel.app", now })).rejects.toMatchObject({
      code: "CHALLENGE_NOT_FOUND",
    });
    const c2 = await issueChallenge(repo, { wallet: w.address, origin, now });
    await expect(verifyChallenge(repo, { nonce: c2.nonce, signature: "1111", originHost: "briefcommand.vercel.app", now })).rejects.toBeTruthy();
    await expect(
      verifyChallenge(repo, { nonce: c2.nonce, signature: w.signText(c2.message), originHost: "briefcommand.vercel.app", now }),
    ).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  });

  it("a challenge issued for another origin is rejected", async () => {
    const w = wallet();
    const c = await issueChallenge(repo, { wallet: w.address, origin, now: Date.now() });
    await expect(
      verifyChallenge(repo, { nonce: c.nonce, signature: w.signText(c.message), originHost: "evil.example", now: Date.now() }),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
  });

  it("Ed25519 helper rejects wrong lengths", () => {
    expect(verifyEd25519(new Uint8Array(31), new Uint8Array(1), new Uint8Array(64))).toBe(false);
    expect(verifyEd25519(new Uint8Array(32), new Uint8Array(1), new Uint8Array(63))).toBe(false);
  });
});

describe("room session cookie", () => {
  const secret = "s".repeat(40);
  it("round-trips, and rejects tampering, expiry and a wrong secret", () => {
    const w = wallet().address;
    const now = Date.now();
    const { value } = signSession(w, now, secret);
    expect(readSession(value, now + 1, secret)?.wallet).toBe(w);
    expect(readSession(value, now + SESSION_TTL_MS + 1, secret)).toBeNull();
    expect(readSession(value, now, "t".repeat(40))).toBeNull();
    const [v, payload, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, w: wallet().address, iat: now, exp: now + 1e6 })).toString("base64url");
    expect(readSession(`${v}.${forged}.${sig}`, now, secret)).toBeNull();
    expect(readSession(`${v}.${payload}.${sig}x`, now, secret)).toBeNull();
  });
  it("production without ROOMS_SESSION_SECRET fails closed; dev gets a dev-only secret", () => {
    expect(sessionSecret({ NODE_ENV: "production" })).toBeNull();
    expect(sessionSecret({ NODE_ENV: "production", ROOMS_SESSION_SECRET: "short" })).toBeNull();
    expect(sessionSecret({ NODE_ENV: "production", ROOMS_SESSION_SECRET: secret })).toBe(secret);
    expect(sessionSecret({ NODE_ENV: "development" })).toMatch(/^dev-only-/);
  });
});

// ---------------------------------------------------------------- 5. service + market validation

const pantaMarket = (over: Partial<Market> = {}): Market => ({
  marketId: MARKET_A,
  title: "Will France beat Belgium?",
  category: "sports",
  phase: "primary",
  status: "primary",
  endTime: Math.floor(Date.now() / 1000) + 86_400,
  yesPrice: "0.6",
  noPrice: "0.4",
  ...over,
});

describe("room service", () => {
  const input = (slug: string, marketId = MARKET_A) =>
    CreateRoomInput.parse({ title: "France vs Belgium", description: "", slug, marketId, idempotencyKey: `key-${slug}-0000000000` });

  it("checkPantaMarket: missing / mismatched / cancelled are rejected", () => {
    expect(checkPantaMarket(MARKET_A, null)).toMatchObject({ ok: false, code: "MARKET_NOT_FOUND" });
    expect(checkPantaMarket(MARKET_B, pantaMarket())).toMatchObject({ ok: false, code: "MARKET_NOT_FOUND" });
    expect(checkPantaMarket(MARKET_A, pantaMarket({ phase: "cancelled", status: "cancelled" }))).toMatchObject({ ok: false, code: "MARKET_CANCELLED" });
    expect(checkPantaMarket(MARKET_A, pantaMarket())).toEqual({ ok: true, marketId: MARKET_A });
    expect(checkPantaMarket(MARKET_A, pantaMarket({ phase: "resolved", resolved: true, outcome: "no" })).ok).toBe(true);
  });

  it("invalid Panta market: nothing is persisted", async () => {
    const repo = new SqliteRoomRepository(tmpDbFile());
    const validateMarket: MarketValidator = async () => ({ ok: false, code: "MARKET_NOT_FOUND", message: "no" });
    await expect(createRoom({ repo, validateMarket, now: Date.now }, wallet().address, input("ghost-market"))).rejects.toBeInstanceOf(MarketRejectedError);
    expect(await repo.getRoomBySlug("ghost-market")).toBeNull();
  });

  it("creator comes from the verified wallet argument", async () => {
    const repo = new SqliteRoomRepository(tmpDbFile());
    const w = wallet().address;
    const res = await createRoom({ repo, validateMarket: async (id) => ({ ok: true, marketId: id }), now: () => 42_000 }, w, input("mine-room"));
    expect(res.room.creatorWallet).toBe(w);
    expect(res.room.createdAt).toBe(new Date(42_000).toISOString());
  });
});

// ---------------------------------------------------------------- 6. market lifecycle integration

describe("room market context reuses the canonical lifecycle", () => {
  it("primary market: validated probability + trade CTA to the canonical market route", () => {
    const m = pantaMarket();
    const st = marketState({ marketId: m.marketId, market: m });
    expect(roomMarketPrice(m, st)).toEqual({ kind: "probability", yes: 0.6, no: 0.4, settled: false });
    expect(roomMarketCta(m.marketId, st)).toMatchObject({ href: `/markets/${MARKET_A}`, label: "Open market & trade" });
  });

  it("secondary market: USDC last-observed, never a probability", () => {
    const m = pantaMarket({ phase: "secondary", status: "secondary", yesPrice: null, noPrice: null, secondaryYesPrice: "600000000", secondaryNoPrice: "450000000" });
    const st = marketState({ marketId: m.marketId, market: m });
    const p = roomMarketPrice(m, st);
    expect(p.kind).toBe("secondary_last_observed");
    expect(roomMarketCta(m.marketId, st).label).toBe("Open market");
  });

  it("missing price is unavailable, not 0 %", () => {
    const m = pantaMarket({ yesPrice: null, noPrice: null });
    const p = roomMarketPrice(m, marketState({ marketId: m.marketId, market: m }));
    expect(p.kind).toBe("unavailable");
  });

  it("expiry alone is closed, not resolved; API failure is unavailable, not closed", () => {
    const ended = pantaMarket({ endTime: Math.floor(Date.now() / 1000) - 60 });
    expect(marketState({ marketId: ended.marketId, market: ended }).kind).toBe("closed");
    expect(marketState({ marketId: MARKET_A, market: null, error: new Error("x") })).toMatchObject({ kind: "unavailable", reason: "api_error" });
    expect(roomMarketPrice(null, marketState({ marketId: MARKET_A, market: null, error: new Error("x") })).kind).toBe("unavailable");
  });

  it("timing lists only what Panta reported", () => {
    expect(roomMarketTiming(pantaMarket({ primaryPhaseEndTime: null, resolutionTime: undefined })).map((t) => t.label)).toEqual(["Event ends"]);
    expect(roomMarketTiming(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 7. HTTP route handlers

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
let routes: {
  challenge: Handler;
  verify: Handler;
  session: Handler;
  list: Handler;
  create: Handler;
  getOne: Handler;
  patch: Handler;
  slugCheck: Handler;
};

let ipSeq = 0;
const freshIp = () => `198.51.100.${(++ipSeq % 250) + 1}`;

function req(url: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { "x-vercel-forwarded-for": init.ip ?? freshIp() };
  if (init.origin !== null) headers.origin = init.origin ?? "http://localhost";
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function signIn(w = wallet()): Promise<{ cookie: string; address: string }> {
  const c = await routes.challenge(req("/api/rooms/auth/challenge", { method: "POST", body: { wallet: w.address } }));
  expect(c.status).toBe(200);
  const { nonce, message } = (await c.json()) as { nonce: string; message: string };
  const v = await routes.verify(req("/api/rooms/auth/verify", { method: "POST", body: { nonce, signature: w.signText(message) } }));
  expect(v.status).toBe(200);
  const set = v.headers.get("set-cookie") || "";
  expect(set).toContain(`${SESSION_COOKIE}=`);
  expect(set.toLowerCase()).toContain("httponly");
  expect(set.toLowerCase()).toContain("samesite=strict");
  const value = set.split(";")[0];
  return { cookie: value, address: w.address };
}

describe("rooms HTTP API", () => {
  let validatorCalls: string[] = [];
  beforeAll(async () => {
    routes = {
      challenge: (await import("@/app/api/rooms/auth/challenge/route")).POST as Handler,
      verify: (await import("@/app/api/rooms/auth/verify/route")).POST as Handler,
      session: (await import("@/app/api/rooms/auth/session/route")).GET as Handler,
      list: (await import("@/app/api/rooms/route")).GET as Handler,
      create: (await import("@/app/api/rooms/route")).POST as Handler,
      getOne: (await import("@/app/api/rooms/[slug]/route")).GET as Handler,
      patch: (await import("@/app/api/rooms/[slug]/route")).PATCH as Handler,
      slugCheck: (await import("@/app/api/rooms/slug-check/route")).GET as Handler,
    };
  });
  beforeEach(() => {
    validatorCalls = [];
    __setRoomRepositoryForTests(new SqliteRoomRepository(tmpDbFile()));
    __setRoomDepsForTests({
      validateMarket: async (id) => {
        validatorCalls.push(id);
        return id === MARKET_A ? { ok: true, marketId: id } : { ok: false, code: "MARKET_NOT_FOUND", message: "Panta has no market with this id." };
      },
    });
  });
  afterEach(() => {
    __setRoomRepositoryForTests(undefined);
    __setRoomDepsForTests({});
  });

  const body = (slug: string, over: Record<string, unknown> = {}) => ({
    title: "France vs Belgium room",
    description: "Evidence and takes.",
    slug,
    marketId: MARKET_A,
    visibility: "public",
    idempotencyKey: `k-${slug}-00000000000000`.slice(0, 40),
    ...over,
  });

  it("end-to-end: sign in, create, read by slug, list, session", async () => {
    const { cookie, address } = await signIn();
    const s = await routes.session(req("/api/rooms/auth/session", { cookie }));
    expect(((await s.json()) as { wallet: string }).wallet).toBe(address);

    const c = await routes.create(req("/api/rooms", { method: "POST", body: body("e2e-room"), cookie }));
    expect(c.status).toBe(201);
    const created = (await c.json()) as { status: string; url: string; room: { creatorWallet: string; slug: string; marketId: string } };
    expect(created).toMatchObject({ status: "created", url: "/rooms/e2e-room" });
    expect(created.room.creatorWallet).toBe(address);
    expect(validatorCalls).toEqual([MARKET_A]);

    const one = await routes.getOne(req("/api/rooms/e2e-room"), slugCtx("e2e-room"));
    expect(one.status).toBe(200);
    expect(((await one.json()) as { room: { title: string } }).room.title).toBe("France vs Belgium room");

    const list = await routes.list(req("/api/rooms"));
    expect(list.status).toBe(200);
    expect(((await list.json()) as { rooms: { slug: string }[] }).rooms.map((r) => r.slug)).toEqual(["e2e-room"]);
  });

  it("empty directory is an empty list, not an error", async () => {
    const list = await routes.list(req("/api/rooms"));
    expect(list.status).toBe(200);
    expect(((await list.json()) as { rooms: unknown[] }).rooms).toEqual([]);
  });

  it("create without a verified wallet → 401; client-supplied creatorWallet → 400", async () => {
    const anon = await routes.create(req("/api/rooms", { method: "POST", body: body("anon-room") }));
    expect(anon.status).toBe(401);
    const forgedCookie = `${SESSION_COOKIE}=v1.${Buffer.from(JSON.stringify({ v: 1, w: wallet().address, iat: 0, exp: 9e15 })).toString("base64url")}.AAAA`;
    expect((await routes.create(req("/api/rooms", { method: "POST", body: body("forged-room"), cookie: forgedCookie }))).status).toBe(401);
    const { cookie } = await signIn();
    const spoof = await routes.create(req("/api/rooms", { method: "POST", body: body("spoof-room", { creatorWallet: wallet().address }), cookie }));
    expect(spoof.status).toBe(400);
  });

  it("cross-origin or origin-less mutations are rejected", async () => {
    const { cookie } = await signIn();
    expect((await routes.create(req("/api/rooms", { method: "POST", body: body("x-room"), cookie, origin: "https://evil.example" }))).status).toBe(403);
    expect((await routes.create(req("/api/rooms", { method: "POST", body: body("y-room"), cookie, origin: null }))).status).toBe(403);
    expect((await routes.challenge(req("/api/rooms/auth/challenge", { method: "POST", body: { wallet: wallet().address }, origin: "https://evil.example" }))).status).toBe(403);
  });

  it("duplicate slug → 409 SLUG_TAKEN; repeated request → same room (200 replayed)", async () => {
    const { cookie } = await signIn();
    const first = await routes.create(req("/api/rooms", { method: "POST", body: body("dupe-room"), cookie }));
    expect(first.status).toBe(201);
    const roomId = ((await first.json()) as { room: { roomId: string } }).room.roomId;
    const again = await routes.create(req("/api/rooms", { method: "POST", body: body("dupe-room"), cookie }));
    expect(again.status).toBe(200);
    expect((await again.json()) as { status: string; room: { roomId: string } }).toMatchObject({ status: "replayed", room: { roomId } });

    const other = await signIn();
    const clash = await routes.create(req("/api/rooms", { method: "POST", body: body("dupe-room", { idempotencyKey: "another-key-000000000" }), cookie: other.cookie }));
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { code: string }).code).toBe("SLUG_TAKEN");
  });

  it("invalid Panta market → 422, nothing saved", async () => {
    const { cookie } = await signIn();
    const r = await routes.create(req("/api/rooms", { method: "POST", body: body("bad-market", { marketId: MARKET_B }), cookie }));
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe("MARKET_NOT_FOUND");
    expect((await routes.getOne(req("/api/rooms/bad-market"), slugCtx("bad-market"))).status).toBe(404);
  });

  it("missing room → 404; slug check reports taken / reserved / free", async () => {
    expect((await routes.getOne(req("/api/rooms/nope-room"), slugCtx("nope-room"))).status).toBe(404);
    expect((await routes.getOne(req("/api/rooms/BAD!"), slugCtx("BAD!"))).status).toBe(404);
    const { cookie } = await signIn();
    await routes.create(req("/api/rooms", { method: "POST", body: body("check-room"), cookie }));
    const taken = (await (await routes.slugCheck(req("/api/rooms/slug-check?slug=check-room"))).json()) as { available: boolean };
    const reserved = (await (await routes.slugCheck(req("/api/rooms/slug-check?slug=create"))).json()) as { available: boolean; reason: string };
    const free = (await (await routes.slugCheck(req("/api/rooms/slug-check?slug=free-room"))).json()) as { available: boolean };
    expect(taken.available).toBe(false);
    expect(reserved).toMatchObject({ available: false, reason: "reserved" });
    expect(free.available).toBe(true);
  });

  it("PATCH: only the creator; others get 403", async () => {
    const owner = await signIn();
    await routes.create(req("/api/rooms", { method: "POST", body: body("owned-room"), cookie: owner.cookie }));
    const stranger = await signIn();
    expect((await routes.patch(req("/api/rooms/owned-room", { method: "PATCH", body: { title: "Mine now" }, cookie: stranger.cookie }), slugCtx("owned-room"))).status).toBe(403);
    const okRes = await routes.patch(req("/api/rooms/owned-room", { method: "PATCH", body: { title: "Better title" }, cookie: owner.cookie }), slugCtx("owned-room"));
    expect(okRes.status).toBe(200);
    expect(((await okRes.json()) as { room: { title: string } }).room.title).toBe("Better title");
  });

  it("replayed verify over HTTP is rejected", async () => {
    const w = wallet();
    const c = await routes.challenge(req("/api/rooms/auth/challenge", { method: "POST", body: { wallet: w.address } }));
    const { nonce, message } = (await c.json()) as { nonce: string; message: string };
    const sig = w.signText(message);
    expect((await routes.verify(req("/api/rooms/auth/verify", { method: "POST", body: { nonce, signature: sig } }))).status).toBe(200);
    const replay = await routes.verify(req("/api/rooms/auth/verify", { method: "POST", body: { nonce, signature: sig } }));
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { code: string }).code).toBe("CHALLENGE_NOT_FOUND");
  });

  it("oversized body → 413; unconfigured production store → 503 on read and create", async () => {
    const { cookie } = await signIn();
    const big = await routes.create(req("/api/rooms", { method: "POST", body: body("big-room", { description: "x".repeat(6000) }), cookie }));
    expect(big.status).toBe(413);
    __setRoomRepositoryForTests(createRoomRepository({ kind: "unavailable", reason: "test" }));
    const list = await routes.list(req("/api/rooms"));
    expect(list.status).toBe(503);
    expect(((await list.json()) as { code: string }).code).toBe("ROOMS_STORE_UNCONFIGURED");
    expect((await routes.create(req("/api/rooms", { method: "POST", body: body("nowhere-room"), cookie }))).status).toBe(503);
  });
});
