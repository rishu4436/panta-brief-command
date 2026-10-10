/**
 * Prediction Rooms: domain model + validation (pure; safe for client and server).
 *
 * A room is a community destination that references exactly ONE canonical
 * Panta market by id (the Event PDA, see lib/panta/lifecycle.ts). The room
 * never copies prices, outcomes, settlement or lifecycle: every surface reads
 * those live from Panta through the existing market data layer. That keeps
 * Panta authoritative and avoids a second market model.
 *
 * Extensibility: future phases (forecasts, discussion, leaderboards) attach
 * their own records keyed by `roomId`; the room record itself stays small.
 */

import { z } from "zod";
import { canonicalMarketId } from "@/lib/panta/lifecycle";

export const ROOM_SCHEMA_VERSION = 1 as const;

export const ROOM_VISIBILITIES = ["public", "unlisted"] as const;
export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];

/** Only "active" is produced in V1; "archived" is reserved for creator moderation later. */
export const ROOM_STATUSES = ["active", "archived"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const TITLE_MIN = 4;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 500;
export const SLUG_MIN = 3;
export const SLUG_MAX = 48;

/**
 * Slugs that would collide with static routes (/rooms/create) or API
 * sub-routes (/api/rooms/auth, /api/rooms/slug-check), or read as
 * official pages. Rejected at validation time.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "create",
  "new",
  "edit",
  "auth",
  "api",
  "admin",
  "settings",
  "mine",
  "me",
  "slug-check",
  "search",
  "official",
  "panta",
  "brief-command",
  "rooms",
  "room",
  "null",
  "undefined",
]);

/** Persisted room record (server side; timestamps are unix ms). */
export type RoomRecord = {
  roomId: string;
  slug: string;
  title: string;
  description: string;
  /** Base58 Solana public key proven by a signed challenge (never client-supplied). */
  creatorWallet: string;
  /** Canonical Panta market id (Event PDA). A reference only. */
  marketId: string;
  visibility: RoomVisibility;
  status: RoomStatus;
  createdAt: number;
  updatedAt: number;
};

/** Public, serialised room (API + pages). */
export type Room = Omit<RoomRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
  schemaVersion: typeof ROOM_SCHEMA_VERSION;
};

export function serializeRoom(r: RoomRecord): Room {
  return {
    roomId: r.roomId,
    slug: r.slug,
    title: r.title,
    description: r.description,
    creatorWallet: r.creatorWallet,
    marketId: r.marketId,
    visibility: r.visibility,
    status: r.status,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    schemaVersion: ROOM_SCHEMA_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Text normalisation

// C0/C1 controls, bidi overrides/isolates and zero-width chars: never stored.
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Single-line text: unsafe chars removed, whitespace collapsed, trimmed. */
export function cleanLine(s: string): string {
  return s.normalize("NFC").replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
}

/** Multi-line text: unsafe chars removed, at most one blank line in a row, trimmed. */
export function cleanMultiline(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE_CHARS, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const charLen = (s: string) => [...s].length;

// ---------------------------------------------------------------------------
// Slugs

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** URL-safe slug proposal from a title (ASCII letters/digits + single hyphens). */
export function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= SLUG_MAX) return base;
  const cut = base.slice(0, SLUG_MAX);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen >= SLUG_MIN ? cut.slice(0, lastHyphen) : cut).replace(/-+$/g, "");
}

export type SlugProblem = "too_short" | "too_long" | "format" | "reserved";

export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN) return "too_short";
  if (slug.length > SLUG_MAX) return "too_long";
  if (!SLUG_RE.test(slug)) return "format";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}

export const SLUG_PROBLEM_TEXT: Record<SlugProblem, string> = {
  too_short: `Use at least ${SLUG_MIN} characters.`,
  too_long: `Use at most ${SLUG_MAX} characters.`,
  format: "Use lowercase letters, numbers and single hyphens (no leading or trailing hyphen).",
  reserved: "This address is reserved. Pick another.",
};

// ---------------------------------------------------------------------------
// Input schemas (strict: unknown keys such as `creatorWallet` are rejected)

const Title = z
  .string()
  .max(TITLE_MAX * 4)
  .transform(cleanLine)
  .refine((s) => charLen(s) >= TITLE_MIN, `Title needs at least ${TITLE_MIN} characters.`)
  .refine((s) => charLen(s) <= TITLE_MAX, `Title can be at most ${TITLE_MAX} characters.`);

const Description = z
  .string()
  .max(DESCRIPTION_MAX * 4)
  .transform(cleanMultiline)
  .refine((s) => charLen(s) <= DESCRIPTION_MAX, `Description can be at most ${DESCRIPTION_MAX} characters.`);

const Slug = z
  .string()
  .max(SLUG_MAX * 2)
  .transform((s) => s.trim().toLowerCase())
  .superRefine((s, ctx) => {
    const p = slugProblem(s);
    if (p) ctx.addIssue({ code: "custom", message: SLUG_PROBLEM_TEXT[p] });
  });

const MarketId = z
  .string()
  .max(64)
  .transform((s, ctx) => {
    const id = canonicalMarketId(s);
    if (!id) {
      ctx.addIssue({ code: "custom", message: "Not a valid Panta market id." });
      return z.NEVER;
    }
    return id;
  });

/** Client-generated per-attempt key; same key + same payload = same room. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const CreateRoomInput = z.strictObject({
  title: Title,
  description: Description.default(""),
  slug: Slug,
  marketId: MarketId,
  visibility: z.enum(ROOM_VISIBILITIES).default("public"),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_RE, "Invalid idempotency key."),
});
export type CreateRoomInput = z.infer<typeof CreateRoomInput>;

export const UpdateRoomInput = z
  .strictObject({
    title: Title.optional(),
    description: Description.optional(),
  })
  .refine((v) => v.title !== undefined || v.description !== undefined, "Nothing to update.");
export type UpdateRoomInput = z.infer<typeof UpdateRoomInput>;

/** The fields that define "the same create request" for idempotency. */
export function createRequestFingerprint(i: Pick<CreateRoomInput, "title" | "description" | "slug" | "marketId" | "visibility">): string {
  return JSON.stringify([i.title, i.description, i.slug, i.marketId, i.visibility]);
}

/** Room ids: "room_" + 24 lowercase hex chars (96 random bits). */
export const ROOM_ID_RE = /^room_[a-f0-9]{24}$/;

export function roomPath(slug: string): string {
  return `/rooms/${encodeURIComponent(slug)}`;
}
