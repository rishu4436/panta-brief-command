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

import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import bs58 from "bs58";
import { RoomStoreUnavailableError, type AuthChallengeRecord, type AuthSessionRecord, type RoomRepository } from "./store/types";

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

/** Single line (SIWS statements may not contain newlines). Carries the purpose in words. */
export const AUTH_STATEMENT =
  "Verify wallet ownership for Prediction Rooms on Brief Command. Free signature, not a transaction; it cannot move funds or approve anything.";
export const SIWS_CHAIN_ID = "mainnet";

/** RFC 3339 / ISO-8601 UTC, second precision, e.g. 2026-10-10T09:15:00Z. */
export const siwsTime = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Strict Sign-In-With-Solana (EIP-4361 style) text, field for field what
 * @solana/wallet-standard-util createSignInMessageText produces and what
 * Phantom's parser accepts: header, address, blank, one-line statement,
 * blank, then only standard fields in standard order. The purpose travels in
 * the statement and as the Request ID; nothing non-standard is appended.
 */
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
    AUTH_STATEMENT,
    "",
    `URI: ${p.uri}`,
    "Version: 1",
    `Chain ID: ${SIWS_CHAIN_ID}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${siwsTime(p.issuedAt)}`,
    `Expiration Time: ${siwsTime(p.expiresAt)}`,
    `Request ID: ${AUTH_PURPOSE}`,
  ].join("\n");
}

export async function issueChallenge(
  repo: RoomRepository,
  p: { wallet: string; origin: string; now: number },
): Promise<AuthChallengeRecord> {
  if (!decodeWallet(p.wallet)) throw new RoomAuthError("INVALID_WALLET", 400, "Not a valid Solana wallet address.");
  const url = new URL(p.origin);
  const nonce = randomBytes(16).toString("hex");
  // Second precision so the stored times are exactly the ones in the message.
  const issuedAt = Math.floor(p.now / 1000) * 1000;
  const expiresAt = issuedAt + CHALLENGE_TTL_MS;
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
  // The stored text must be a strict SIWS message whose fields are exactly
  // this challenge's: binds domain, URI host, wallet, nonce, purpose (Request
  // ID), chain and expiry to the bytes that were signed.
  if (challenge.nonce !== p.nonce || !messageMatchesChallenge(challenge)) {
    throw new RoomAuthError("CHALLENGE_NOT_FOUND", 401, "This sign-in request is unknown or was already used. Start again.");
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

// Same grammar as @solana/wallet-standard-util parseSignInMessageText (SIWS).
const SIWS_RE = new RegExp(
  "^(?<domain>[^\\n]+?) wants you to sign in with your Solana account:\\n(?<address>[^\\n]+)(?:\\n|$)" +
    "(?:\\n(?<statement>[\\S\\s]*?)(?:\\n|$))??" +
    "(?:\\nURI: (?<uri>[^\\n]+))?(?:\\nVersion: (?<version>[^\\n]+))?(?:\\nChain ID: (?<chainId>[^\\n]+))?" +
    "(?:\\nNonce: (?<nonce>[^\\n]+))?(?:\\nIssued At: (?<issuedAt>[^\\n]+))?(?:\\nExpiration Time: (?<expirationTime>[^\\n]+))?" +
    "(?:\\nNot Before: (?<notBefore>[^\\n]+))?(?:\\nRequest ID: (?<requestId>[^\\n]+))?" +
    "(?:\\nResources:(?<resources>(?:\\n- [^\\n]+)*))?\\n*$",
);

export function parseSiwsMessage(text: string): Record<string, string | undefined> | null {
  const m = SIWS_RE.exec(text);
  return m?.groups ? { ...m.groups } : null;
}

function messageMatchesChallenge(c: AuthChallengeRecord): boolean {
  const f = parseSiwsMessage(c.message);
  if (!f || !f.uri) return false;
  let uriHost: string;
  try {
    uriHost = new URL(f.uri).host;
  } catch {
    return false;
  }
  return (
    f.domain === c.domain &&
    uriHost === c.domain &&
    f.address === c.wallet &&
    f.statement === AUTH_STATEMENT &&
    f.version === "1" &&
    f.chainId === SIWS_CHAIN_ID &&
    f.nonce === c.nonce &&
    f.issuedAt === siwsTime(c.issuedAt) &&
    f.expirationTime === siwsTime(c.expiresAt) &&
    f.requestId === AUTH_PURPOSE &&
    f.notBefore === undefined &&
    f.resources === undefined
  );
}

// ---------------------------------------------------------------------------
// Session cookie (HMAC-SHA256 signed, HttpOnly, short TTL) + server-side
// active-session record.
//
// A cookie is accepted only if (1) its HMAC verifies, (2) it hasn't expired,
// and (3) the store still holds an ACTIVE record for its session id with the
// same wallet. Sign-out deletes the record, so a copied cookie stops working
// at once. Allowlist, not a revocation list: a lost or missing record denies
// (fail closed), legacy cookies have no record, and records expire with the
// session (Redis PX TTL; SQLite expires_at + sweep). The store keeps only
// SHA-256(sid); the sid itself lives only inside the signed HttpOnly cookie.
//
// v2 cookies carry a 256-bit random sid. v1 cookies (Phase ≤ 7B, no tracked
// sid) are rejected outright: the version and MAC domain both changed.

export type RoomSession = { wallet: string; issuedAt: number; expiresAt: number; sid: string };

export const SESSION_COOKIE_VERSION = "v2";
const SID_RE = /^[A-Za-z0-9_-]{43}$/;

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
  createHmac("sha256", secret).update(`pbc-rooms-session.${SESSION_COOKIE_VERSION}.${payload}`).digest();

/** What the store keys a session by (never the raw sid). */
export function sessionIdHash(sid: string): string {
  return createHash("sha256").update(`pbc-rooms-sid.${sid}`).digest("hex");
}

/** Pure: mint a signed cookie value. Use issueSession() to also register it (required for it to work). */
export function signSession(wallet: string, now: number, secret: string): { value: string; session: RoomSession } {
  const session: RoomSession = { wallet, issuedAt: now, expiresAt: now + SESSION_TTL_MS, sid: randomBytes(32).toString("base64url") };
  const payload = b64u(JSON.stringify({ v: 2, w: session.wallet, iat: session.issuedAt, exp: session.expiresAt, sid: session.sid }));
  return { value: `${SESSION_COOKIE_VERSION}.${payload}.${b64u(mac(secret, payload))}`, session };
}

export function sessionRecord(s: RoomSession): AuthSessionRecord {
  return { sidHash: sessionIdHash(s.sid), wallet: s.wallet, issuedAt: s.issuedAt, expiresAt: s.expiresAt };
}

/**
 * Sign + register an active session. If the store can't record it, this
 * throws and no cookie must be set (sign-in fails closed).
 */
export async function issueSession(repo: Pick<RoomRepository, "createSession">, wallet: string, now: number, secret: string): Promise<{ value: string; session: RoomSession }> {
  const out = signSession(wallet, now, secret);
  try {
    await repo.createSession(sessionRecord(out.session));
  } catch (e) {
    // Any failure to record the session is a store outage for the caller (503, no cookie).
    if (e instanceof RoomStoreUnavailableError) throw e;
    throw new RoomStoreUnavailableError("failure", "session could not be recorded");
  }
  return out;
}

/**
 * Verify the cookie's MAC and shape. `allowExpired` is only for sign-out
 * (revoking an expired session is harmless); it never authenticates.
 */
export function readSession(value: string | undefined | null, now: number, secret: string | null, opts: { allowExpired?: boolean } = {}): RoomSession | null {
  if (!value || !secret || value.length > 1024) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_COOKIE_VERSION) return null;
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
    if (p.v !== 2 || typeof p.w !== "string" || !decodeWallet(p.w)) return null;
    if (typeof p.sid !== "string" || !SID_RE.test(p.sid)) return null;
    if (typeof p.exp !== "number" || typeof p.iat !== "number") return null;
    if (!opts.allowExpired && p.exp <= now) return null;
    return { wallet: p.w, issuedAt: p.iat, expiresAt: p.exp, sid: p.sid };
  } catch {
    return null;
  }
}

export type SessionCheck = { session: RoomSession | null; unavailable: boolean };

/**
 * The full check for an authenticated request: signed cookie AND an active
 * store record for the same wallet that hasn't expired. A store error is
 * reported as `unavailable` (callers fail closed: 503 on authenticated ops).
 */
export async function checkSession(repo: Pick<RoomRepository, "getActiveSession">, value: string | undefined | null, now: number, secret: string | null): Promise<SessionCheck> {
  const s = readSession(value, now, secret);
  if (!s) return { session: null, unavailable: false };
  let rec: AuthSessionRecord | null;
  try {
    rec = await repo.getActiveSession(sessionIdHash(s.sid), now);
  } catch {
    return { session: null, unavailable: true };
  }
  if (!rec || rec.wallet !== s.wallet || rec.expiresAt <= now || rec.expiresAt !== s.expiresAt) return { session: null, unavailable: false };
  return { session: s, unavailable: false };
}

/** Sign-out: delete the active record (idempotent). Unsigned / legacy cookies: nothing to revoke. */
export async function revokeSessionCookie(repo: Pick<RoomRepository, "revokeSession">, value: string | undefined | null, now: number, secret: string | null): Promise<boolean> {
  const s = readSession(value, now, secret, { allowExpired: true });
  if (!s) return false;
  await repo.revokeSession(sessionIdHash(s.sid));
  return true;
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
