/**
 * Market-creation input rules shared by the Create Market workspace (client)
 * and the /api/panta proxy (server). Pure: no web3, no React, no fetch.
 *
 * Sources (6 Oct 2026):
 *  - docs.panta.market api-reference/markets/{overview,image-upload,quote,build,register}
 *  - Kaito-HQ/panta-api-playground @ a92b0db (CreateMarketFlow.tsx, marketImageUpload.ts, types.ts)
 *  - GET /categories/ (live) → sports, crypto, politics, entertainment, finance, science, world, other
 *  - on-chain MarketConfig 8mJjfx7S… (minimum_start_delay = 3600 s)
 *  - balr_market IDL errors: BreakingEventTooFarFutureUsdc (6090, "within 72 hours")
 *  - real create builds: tx size = 728 bytes + on-chain text bytes (see onChainTextBytes)
 */

import { BASE58_PUBKEY_RE } from "./routes";

/** Panta's category allowlist (GET /categories/, 6 Oct 2026). Server rejection stays authoritative. */
export const CREATE_CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"] as const;
export type CreateCategory = (typeof CREATE_CATEGORIES)[number];
export const CREATE_MARKET_TYPES = ["standard", "breaking"] as const;
export type CreateMarketType = (typeof CREATE_MARKET_TYPES)[number];

/** Documented Panta limits (quote docs) and our own conservative bounds. */
export const CREATE_LIMITS = {
  questionMax: 512, // docs
  questionMin: 10,
  ruleMax: 2048, // docs
  ruleMin: 20,
  sourcesMax: 20, // docs ("Non-empty list (max 20)")
  /** UI cap: every source is written on-chain, so a long list cannot fit the transaction anyway. */
  sourcesUiMax: 5,
  sourceUrlMax: 512,
  imageUrlMax: 2048, // docs
  titleMax: 200, // not documented; conservative
  descriptionMax: 2000, // not documented; conservative
  regionMax: 64, // not documented; conservative
} as const;

/**
 * On-chain text budget. question + resolution rule + every source are
 * borsh-encoded into the create instruction. Measured on real builds:
 * serialized tx bytes = 728 + onChainTextBytes() for Breaking (727 for
 * Standard, which has no event_in_progress byte). Solana's packet limit is
 * 1232 bytes, so the hard ceiling is 504; we keep a small margin. Panta's
 * build does NOT check this (a 1239-byte tx was returned in discovery).
 */
export const ONCHAIN_TEXT_BUDGET = 500;
export const OBSERVED_TX_OVERHEAD_BYTES = 728;
export const SOLANA_PACKET_BYTES = 1232;

/** On-chain minimum start delay (MarketConfig.minimum_start_delay, read 6 Oct 2026). */
export const MIN_START_DELAY_SEC = 3600;
/**
 * Brief Command's conservative Standard-market rule. Panta's Breaking tier
 * covers events that start within 72 hours (on-chain error 6090
 * BreakingEventTooFarFutureUsdc), so Standard markets here are reserved for
 * events at least 72 hours out. The on-chain minimum is smaller (1 hour);
 * Panta's own server rejection remains authoritative.
 */
export const STANDARD_MIN_LEAD_SEC = 72 * 3600;
/** On-chain: a Breaking event must start within 72 hours (USDC markets). */
export const BREAKING_MAX_LEAD_SEC = 72 * 3600;

/** The image host Panta's image-upload signs for (observed uploadUrl, 6 Oct 2026). */
export const CLOUDINARY_CLOUD = "dyvupboym";
export const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;
export const CLOUDINARY_DELIVERY_PREFIX = `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/`;
export const IMAGE_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const UNIX_MIN = 1_577_836_800; // 2020-01-01
const UNIX_MAX = 4_102_444_800; // 2100-01-01

/** Exactly the fields POST /markets/create/quote/ takes (no oracle: evidence defaults to the declared sources). */
export type CreateInput = {
  wallet: string;
  question: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  category: CreateCategory;
  startTime: number;
  endTime: number;
  resolutionTime: number;
  marketType: CreateMarketType;
  title?: string;
  description?: string;
  imageUrl: string;
  region?: string;
  /** Breaking only. */
  eventInProgress?: boolean;
};

/** Raw form values before normalization. */
export type CreateForm = {
  wallet: string | null;
  question: string;
  title: string;
  description: string;
  category: string;
  marketType: string;
  region: string;
  resolutionRule: string;
  sources: string[];
  imageUrl: string;
  startTime: number | null;
  endTime: number | null;
  resolutionTime: number | null;
  eventInProgress: boolean;
};

const collapse = (s: string) => s.replace(/\r\n?/g, "\n").trim();

/** Canonical quote body from form values (trimmed; blanks omitted; eventInProgress only for breaking). */
export function normalizeCreateForm(f: CreateForm): CreateInput {
  const marketType = (f.marketType === "breaking" ? "breaking" : "standard") as CreateMarketType;
  const out: CreateInput = {
    wallet: (f.wallet ?? "").trim(),
    question: collapse(f.question).replace(/\s+/g, " "),
    resolutionRule: collapse(f.resolutionRule),
    sourcesOfTruth: f.sources.map((s) => s.trim()).filter(Boolean),
    category: f.category as CreateCategory,
    startTime: f.startTime ?? NaN,
    endTime: f.endTime ?? NaN,
    resolutionTime: f.resolutionTime ?? NaN,
    marketType,
    imageUrl: f.imageUrl.trim(),
  };
  const title = collapse(f.title).replace(/\s+/g, " ");
  const description = collapse(f.description);
  const region = collapse(f.region).replace(/\s+/g, " ");
  if (title) out.title = title;
  if (description) out.description = description;
  if (region) out.region = region;
  if (marketType === "breaking") out.eventInProgress = Boolean(f.eventInProgress);
  return out;
}

/**
 * Stable fingerprint of every field sent to Panta. Any change (question,
 * rule, sources, type, image, times, wallet, title, description, region,
 * category, eventInProgress) produces a different fingerprint and
 * invalidates the quote, the build and the review.
 */
export function createInputFingerprint(i: CreateInput): string {
  return JSON.stringify([
    i.wallet,
    i.question,
    i.resolutionRule,
    i.sourcesOfTruth,
    i.category,
    i.startTime,
    i.endTime,
    i.resolutionTime,
    i.marketType,
    i.title ?? null,
    i.description ?? null,
    i.imageUrl,
    i.region ?? null,
    i.marketType === "breaking" ? Boolean(i.eventInProgress) : null,
  ]);
}

/** UTF-8 bytes written into the create instruction for the variable-length fields. */
export function onChainTextBytes(i: Pick<CreateInput, "question" | "resolutionRule" | "sourcesOfTruth">): number {
  const enc = new TextEncoder();
  return (
    enc.encode(i.question).byteLength +
    enc.encode(i.resolutionRule).byteLength +
    i.sourcesOfTruth.reduce((n, s) => n + enc.encode(s).byteLength + 4, 0)
  );
}

export function isHttpsUrl(v: string, max = CREATE_LIMITS.sourceUrlMax): boolean {
  if (typeof v !== "string" || v.length === 0 || v.length > max || /\s/.test(v)) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return false; // no raw IPs
  if (!h.includes(".")) return false;
  return true;
}

/**
 * The uploaded image must be the exact Cloudinary delivery URL for the
 * public id Panta reserved: https://res.cloudinary.com/<cloud>/image/upload/
 * v<version>/<publicId>.<png|jpg|jpeg|webp>, no query or fragment.
 * With `publicId` omitted (server-side check), any asset under Panta's
 * balr-market/events/ folder on the pinned cloud is accepted.
 */
export function isAllowedImageUrl(v: unknown, publicId?: string): boolean {
  if (typeof v !== "string" || v.length > CREATE_LIMITS.imageUrlMax || !v.startsWith(CLOUDINARY_DELIVERY_PREFIX)) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.host !== "res.cloudinary.com" || u.search || u.hash || u.username || u.password) return false;
  if (`${u.origin}${u.pathname}` !== v) return false; // no normalisation tricks (.., %2e, //)
  const rest = v.slice(CLOUDINARY_DELIVERY_PREFIX.length);
  const m = /^v\d{1,12}\/(balr-market\/events\/[A-Za-z0-9_-]{1,96}\/[A-Za-z0-9_-]{1,96})\.(png|jpe?g|webp)$/.exec(rest);
  if (!m) return false;
  return publicId === undefined || m[1] === publicId;
}

export type FieldErrors = Partial<Record<keyof CreateInput | "sources" | "budget", string>>;

/** Timeline rules (Brief Command client side; Panta's rejection stays authoritative). */
export function timelineErrors(i: Pick<CreateInput, "marketType" | "startTime" | "endTime" | "resolutionTime" | "eventInProgress">, nowSec: number): FieldErrors {
  const e: FieldErrors = {};
  const { startTime: s, endTime: en, resolutionTime: r } = i;
  const ok = (t: number) => Number.isInteger(t) && t >= UNIX_MIN && t <= UNIX_MAX;
  if (!ok(s)) e.startTime = "Pick a start date and time.";
  if (!ok(en)) e.endTime = "Pick an end date and time.";
  if (!ok(r)) e.resolutionTime = "Pick a resolution date and time.";
  if (Object.keys(e).length) return e;
  if (!(s < en)) e.endTime = "End must be after the start.";
  else if (!(en <= r)) e.resolutionTime = "Resolution must be at or after the end.";
  if (i.marketType === "standard") {
    if (i.eventInProgress) e.startTime = "“Event already in progress” applies to Breaking markets only.";
    else if (s < nowSec + STANDARD_MIN_LEAD_SEC) {
      e.startTime =
        "Standard markets start at least 72 hours from now in Brief Command. Panta's Breaking tier covers events within 72 hours.";
    }
  } else if (i.eventInProgress) {
    if (s > nowSec) e.startTime = "With “Event already in progress”, the start must be now or in the past.";
    if (en <= nowSec) e.endTime = "The event must still be running: end must be in the future.";
  } else {
    if (s <= nowSec) e.startTime = "Start must be in the future (or mark the event as already in progress).";
    else if (s < nowSec + MIN_START_DELAY_SEC) e.startTime = "Start must be at least 1 hour from now (Panta's on-chain minimum start delay).";
    else if (s > nowSec + BREAKING_MAX_LEAD_SEC) e.startTime = "Breaking markets must start within 72 hours. Use Standard for later events.";
  }
  return e;
}

/** Every pre-quote guard. Empty object = ready to request a quote. */
export function createInputErrors(i: CreateInput, nowSec: number): FieldErrors {
  const e: FieldErrors = {};
  if (!i.wallet) e.wallet = "Connect a wallet. It pays the creation fee and signs the transaction.";
  else if (!BASE58_PUBKEY_RE.test(i.wallet)) e.wallet = "Connected wallet address is not valid.";
  if (i.question.length < CREATE_LIMITS.questionMin) e.question = "Write a clear question (at least 10 characters).";
  else if (i.question.length > CREATE_LIMITS.questionMax) e.question = `Question is limited to ${CREATE_LIMITS.questionMax} characters.`;
  if (i.resolutionRule.length < CREATE_LIMITS.ruleMin) e.resolutionRule = "Describe exactly when the market resolves YES and when NO.";
  else if (i.resolutionRule.length > CREATE_LIMITS.ruleMax) e.resolutionRule = `Resolution rule is limited to ${CREATE_LIMITS.ruleMax} characters.`;
  if (i.sourcesOfTruth.length === 0) e.sources = "Add at least one public source of truth (https link).";
  else if (i.sourcesOfTruth.length > CREATE_LIMITS.sourcesUiMax) e.sources = `Use at most ${CREATE_LIMITS.sourcesUiMax} sources.`;
  else if (!i.sourcesOfTruth.every((s) => isHttpsUrl(s))) e.sources = "Each source must be a public https:// link.";
  else if (new Set(i.sourcesOfTruth).size !== i.sourcesOfTruth.length) e.sources = "Remove duplicate sources.";
  if (!(CREATE_CATEGORIES as readonly string[]).includes(i.category)) e.category = "Choose a category.";
  if (!(CREATE_MARKET_TYPES as readonly string[]).includes(i.marketType)) e.marketType = "Choose a market type.";
  if (!i.imageUrl) e.imageUrl = "Upload a market image.";
  else if (!isAllowedImageUrl(i.imageUrl)) e.imageUrl = "Image must be uploaded through Panta's image upload.";
  if (i.title && i.title.length > CREATE_LIMITS.titleMax) e.title = `Title is limited to ${CREATE_LIMITS.titleMax} characters.`;
  if (i.description && i.description.length > CREATE_LIMITS.descriptionMax) e.description = `Description is limited to ${CREATE_LIMITS.descriptionMax} characters.`;
  if (i.region && i.region.length > CREATE_LIMITS.regionMax) e.region = `Region is limited to ${CREATE_LIMITS.regionMax} characters.`;
  if (!e.question && !e.resolutionRule && !e.sources && onChainTextBytes(i) > ONCHAIN_TEXT_BUDGET) {
    e.budget = `Question, resolution rule and sources are written on-chain and must fit in ${ONCHAIN_TEXT_BUDGET} bytes (now ${onChainTextBytes(i)}). Shorten them.`;
  }
  Object.assign(e, timelineErrors(i, nowSec));
  return e;
}

/** Non-blocking phrasing guidance: YES/NO-resolvable questions. */
/**
 * Suggested (pre-filled) timeline values are never treated as the creator's
 * choice: before a quote, the creator must either tick "I confirm this
 * timeline" or edit a time field themselves.
 */
export type TimelineConfirmation = { confirmed: boolean; edited: boolean };
export const TIMELINE_CONFIRM_REQUIRED = "Confirm the timeline: tick \u201cI confirm this timeline\u201d or adjust a time yourself.";
export function timelineConfirmationError(c: TimelineConfirmation | null | undefined): string | null {
  return c && (c.confirmed === true || c.edited === true) ? null : TIMELINE_CONFIRM_REQUIRED;
}

export function questionGuidance(q: string): string[] {
  const tips: string[] = [];
  const t = q.trim();
  if (!t) return tips;
  if (!t.endsWith("?")) tips.push("Phrase it as a question ending in “?”.");
  if (!/^(will|is|are|does|do|did|has|have|can|could|would|should|was|were)\b/i.test(t)) {
    tips.push("YES/NO questions usually start with “Will…”, “Is…” or “Does…”.");
  }
  if (!/\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\btoday\b|\btonight\b|\bby\b|\bbefore\b/i.test(t)) {
    tips.push("Include a date or deadline so the outcome is unambiguous.");
  }
  if (/\b(best|good|bad|significant|major|soon|likely)\b/i.test(t)) tips.push("Avoid subjective words; use a measurable threshold.");
  return tips;
}

// ---------------------------------------------------------------------------
// Image upload (POST /markets/create/image-upload/ → direct Cloudinary POST)
// ---------------------------------------------------------------------------

export type ImageUploadGrant = {
  uploadUrl: string;
  publicId: string;
  expiresAtMs: number;
  fields: Record<string, string>;
};

const FIELD_KEY_RE = /^[a-z_]{1,32}$/;
const REQUIRED_FIELDS = ["api_key", "timestamp", "signature", "public_id"] as const;

/** Strict parse of Panta's signed-upload response. Anything unexpected throws. */
export function parseImageUploadGrant(raw: unknown, nowMs: number): ImageUploadGrant {
  const bad = (why: string): never => {
    throw new Error(`Image upload grant rejected: ${why}.`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("not an object");
  const r = raw as Record<string, unknown>;
  if (r.uploadUrl !== CLOUDINARY_UPLOAD_URL) return bad("upload URL is not Panta's Cloudinary endpoint");
  if (typeof r.publicId !== "string" || !/^balr-market\/events\/[A-Za-z0-9_-]{1,96}\/[A-Za-z0-9_-]{1,96}$/.test(r.publicId)) {
    return bad("unexpected public id");
  }
  const exp = typeof r.expiresAt === "string" ? Date.parse(r.expiresAt) : NaN;
  if (!Number.isFinite(exp)) return bad("missing expiry");
  if (exp <= nowMs) return bad("signature already expired");
  if (!r.fields || typeof r.fields !== "object" || Array.isArray(r.fields)) return bad("missing signed fields");
  const fields: Record<string, string> = {};
  const entries = Object.entries(r.fields as Record<string, unknown>);
  if (entries.length > 16) return bad("too many fields");
  for (const [k, v] of entries) {
    if (!FIELD_KEY_RE.test(k) || k === "file") return bad(`unexpected field ${k.slice(0, 32)}`);
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return bad(`field ${k} is not a value`);
    const s = String(v);
    if (s.length > 512) return bad(`field ${k} too long`);
    fields[k] = s;
  }
  for (const k of REQUIRED_FIELDS) if (!fields[k]) return bad(`missing ${k}`);
  const folder = fields.folder;
  const full = folder ? `${folder}/${fields.public_id}` : fields.public_id;
  if (full !== r.publicId) return bad("signed public id does not match");
  return { uploadUrl: r.uploadUrl, publicId: r.publicId, expiresAtMs: exp, fields };
}

/** Client file checks before any network call. */
export function imageFileError(file: { type: string; size: number }): string | null {
  if (!(IMAGE_ALLOWED_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPEG or WebP image.";
  if (!(file.size > 0)) return "Image file is empty.";
  if (file.size > IMAGE_MAX_BYTES) return "Image must be 5 MB or smaller.";
  return null;
}

/** Cloudinary's upload response → the exact delivery URL for the reserved public id, or throw. */
export function parseCloudinaryUpload(raw: unknown, grant: Pick<ImageUploadGrant, "publicId">): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Image upload returned an unreadable response.");
  const r = raw as Record<string, unknown>;
  if (r.public_id !== grant.publicId) throw new Error("Image upload stored a different file than Panta reserved.");
  if (r.resource_type !== undefined && r.resource_type !== "image") throw new Error("Uploaded file is not an image.");
  if (r.format !== undefined && !["png", "jpg", "jpeg", "webp"].includes(String(r.format))) throw new Error("Uploaded image format is not allowed.");
  if (!isAllowedImageUrl(r.secure_url, grant.publicId)) throw new Error("Image upload returned an unexpected image URL.");
  return r.secure_url as string;
}
