import "server-only";

/**
 * Wallet ownership for Prediction Rooms: a minimal Sign-In-With-Solana flow.
 * No transaction, no fee, no funds move.
 *
 *  1. POST /api/rooms/auth/challenge {wallet}: the server creates a random
 *     nonce and the exact message to sign (bound to this host, the purpose,
 *     the wallet, issuedAt and a short expiry) and stores it.
 *  2. The wallet signs those bytes with signMessage (Ed25519).
 *  3. POST /api/rooms/auth/verify {nonce, signature}: the server atomically
 *     consumes the stored challenge (single use, so replays fail), rejects it
 *     if expired or requested from another origin, and verifies the signature
 *     with Node's built-in Ed25519 against the wallet IN THE STORED CHALLENGE.
 *     The client never gets to name the wallet at this step.
 *  4. On success the server sets a short-lived, HMAC-signed, HttpOnly session
 *     cookie carrying only that verified wallet. Room creation reads the
 *     creator from this cookie and nothing else.
 */

import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import bs58 from "bs58";
import type { AuthChallengeRecord, RoomRepository } from "./store/types";

export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 30 * 60_000;
export const SESSION_COOKIE = "pbc_rooms_session";
export const AUTH_PURPOSE = "prediction-rooms-auth";
export const NONCE_RE = /^[a-f0-9]{32}$/;

export type AuthErrorCode =
  | "INVALID_WALLET"
  | "INVALID_SIGNATURE_FORMAT"
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "ORIGIN_MISMATCH"
  | "SIGNATURE_INVALID"
  | "AUTH_UNCONFIGURED";

export class RoomAuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "RoomAuthError";
  }
}

/** 32-byte Ed25519 public key from base58, or null. */
export function decodeWallet(raw: unknown): Uint8Array | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length < 32 || s.length > 44) return null;
  try {
    const bytes = bs58.decode(s);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Ed25519 signature check with Node's crypto (no extra dependency). */
export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKey)]), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

export function buildChallengeMessage(p: {
  domain: string;
  uri: string;
  wallet: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): string {
  return [
    `${p.domain} wants you to sign in with your Solana account:`,
    p.wallet,
    "",
    "Verify wallet ownership for Prediction Rooms on Brief Command. This is a free signature, not a transaction: it cannot move funds or approve anything.",
    "",
    `URI: ${p.uri}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${p.nonce}`,
    `Issued At: ${new Date(p.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(p.expiresAt).toISOString()}`,
    `Purpose: ${AUTH_PURPOSE}`,
  ].join("\n");
}

export async function issueChallenge(
  repo: RoomRepository,
  p: { wallet: string; origin: string; now: number },
): Promise<AuthChallengeRecord> {
  if (!decodeWallet(p.wallet)) throw new RoomAuthError("INVALID_WALLET", 400, "Not a valid Solana wallet address.");
  const url = new URL(p.origin);
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = p.now;
  const expiresAt = p.now + CHALLENGE_TTL_MS;
  const wallet = p.wallet.trim();
  const message = buildChallengeMessage({ domain: url.host, uri: url.origin, wallet, nonce, issuedAt, expiresAt });
  const rec: AuthChallengeRecord = { nonce, wallet, message, domain: url.host, issuedAt, expiresAt };
  await repo.saveChallenge(rec);
  return rec;
}

/**
 * Consume + verify. The challenge is consumed BEFORE any check, so a nonce is
 * good for exactly one attempt whatever its outcome. Returns the verified wallet.
 */
export async function verifyChallenge(
  repo: RoomRepository,
  p: { nonce: unknown; signature: unknown; originHost: string | null; now: number },
): Promise<{ wallet: string }> {
  if (typeof p.nonce !== "string" || !NONCE_RE.test(p.nonce)) {
    throw new RoomAuthError("CHALLENGE_NOT_FOUND", 401, "This sign-in request is unknown or was already used. Start again.");
  }
  let sig: Uint8Array | null = null;
  if (typeof p.signature === "string" && p.signature.length <= 100) {
    try {
      sig = bs58.decode(p.signature);
    } catch {
      sig = null;
    }
  }
  const challenge = await repo.consumeChallenge(p.nonce);
  if (!challenge) {
    throw new RoomAuthError("CHALLENGE_NOT_FOUND", 401, "This sign-in request is unknown or was already used. Start again.");
  }
  if (challenge.expiresAt <= p.now) {
    throw new RoomAuthError("CHALLENGE_EXPIRED", 401, "This sign-in request expired. Start again and sign within 5 minutes.");
  }
  if (!p.originHost || p.originHost !== challenge.domain) {
    throw new RoomAuthError("ORIGIN_MISMATCH", 403, "This sign-in request was issued for a different site.");
  }
  if (!sig || sig.length !== 64) {
    throw new RoomAuthError("INVALID_SIGNATURE_FORMAT", 400, "The wallet returned a malformed signature.");
  }
  const pub = decodeWallet(challenge.wallet);
  if (!pub || !verifyEd25519(pub, new TextEncoder().encode(challenge.message), sig)) {
    throw new RoomAuthError("SIGNATURE_INVALID", 401, "The signature doesn't match this wallet and message.");
  }
  return { wallet: challenge.wallet };
}

// ---------------------------------------------------------------------------
// Session cookie (HMAC-SHA256 signed, HttpOnly, short TTL)

export type RoomSession = { wallet: string; issuedAt: number; expiresAt: number; sid: string };

const devSecretKey = Symbol.for("pbc.rooms.devSessionSecret");

/**
 * ROOMS_SESSION_SECRET (≥ 32 chars). Production without it: null, and sign-in
 * fails closed. Development: a random per-process secret (sessions end when
 * the dev server restarts), clearly dev-only.
 */
export function sessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = (env.ROOMS_SESSION_SECRET || "").trim();
  if (s.length >= 32) return s;
  if (env.NODE_ENV === "production") return null;
  const g = globalThis as unknown as Record<symbol, string | undefined>;
  g[devSecretKey] ??= `dev-only-${randomBytes(32).toString("hex")}`;
  return g[devSecretKey]!;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(`pbc-rooms-session.v1.${payload}`).digest();

export function signSession(wallet: string, now: number, secret: string): { value: string; session: RoomSession } {
  const session: RoomSession = { wallet, issuedAt: now, expiresAt: now + SESSION_TTL_MS, sid: randomBytes(9).toString("hex") };
  const payload = b64u(JSON.stringify({ v: 1, w: session.wallet, iat: session.issuedAt, exp: session.expiresAt, sid: session.sid }));
  return { value: `v1.${payload}.${b64u(mac(secret, payload))}`, session };
}

export function readSession(value: string | undefined | null, now: number, secret: string | null): RoomSession | null {
  if (!value || !secret || value.length > 1024) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payload, sigPart] = parts;
  let given: Buffer;
  try {
    given = Buffer.from(sigPart, "base64url");
  } catch {
    return null;
  }
  const expected = mac(secret, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: unknown;
      w?: unknown;
      iat?: unknown;
      exp?: unknown;
      sid?: unknown;
    };
    if (p.v !== 1 || typeof p.w !== "string" || !decodeWallet(p.w)) return null;
    if (typeof p.exp !== "number" || typeof p.iat !== "number" || p.exp <= now) return null;
    return { wallet: p.w, issuedAt: p.iat, expiresAt: p.exp, sid: String(p.sid ?? "") };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(env: Record<string, string | undefined> = process.env, maxAgeMs = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}
