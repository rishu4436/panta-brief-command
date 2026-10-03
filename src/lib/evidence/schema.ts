/**
 * Early-user evidence: shapes, validation and the summary used by the admin
 * export. Client + server safe (no I/O).
 *
 * Privacy: events carry a random anonymous id (localStorage), the event name,
 * the pathname and, where relevant, a market id / brief mode. No IP, no user
 * agent, no cookies, no third-party trackers. A wallet address is included
 * only when a wallet is connected AND the user switched on "include my wallet".
 */

import { z } from "zod";
import { BASE58_PUBKEY_RE } from "@/lib/panta/routes";

export const USAGE_EVENTS = [
  "visit",
  "brief_viewed",
  "quote_requested",
  "sign_attempted",
  "trade_verified",
  "book_opened",
] as const;
export type UsageEventName = (typeof USAGE_EVENTS)[number];

const ANON_ID = /^[a-z0-9-]{8,64}$/i;
const pubkey = z.string().regex(BASE58_PUBKEY_RE);
const modes = z.enum(["desk", "flow", "risk", "catalysts"]);

export const UsageEventInput = z.strictObject({
  anonId: z.string().regex(ANON_ID),
  event: z.enum(USAGE_EVENTS),
  path: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9/_\-.]*$/)
    .optional(),
  marketId: pubkey.optional(),
  mode: modes.optional(),
  wallet: pubkey.optional(),
});
export type UsageEventInput = z.infer<typeof UsageEventInput>;
export type UsageEventRow = UsageEventInput & { t: string };

const thumb = z.enum(["up", "down"]).nullable();

export const FeedbackInput = z
  .strictObject({
    anonId: z.string().regex(ANON_ID).optional(),
    marketId: pubkey,
    mode: modes,
    useful: thumb,
    accurate: thumb,
    comment: z.string().max(500).optional(),
    /** What the user was rating: template vs LLM, signals version, when it was generated. */
    briefSource: z.enum(["openai", "template"]),
    signalsVersion: z.number().int().min(1).max(99),
    generatedAt: z.string().max(40),
  })
  .refine((f) => f.useful != null || f.accurate != null || (f.comment ?? "").trim().length > 0, {
    message: "Rate usefulness or accuracy, or leave a comment",
  });
export type FeedbackInput = z.infer<typeof FeedbackInput>;
export type FeedbackRow = FeedbackInput & { t: string };

/** Strip control characters; collapse whitespace. */
export function cleanComment(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const out = s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  return out || undefined;
}

const istDay = (iso: string) =>
  new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

export type EvidenceSummary = {
  events: { total: number; byEvent: Record<string, number>; firstAt: string | null; lastAt: string | null };
  visitors: {
    unique: number;
    /** Seen on ≥ 2 distinct IST calendar days. */
    returning: number;
    /** Used ≥ 2 distinct workflows (any event other than visit). */
    multiWorkflow: number;
    /** Reached trade_verified. */
    verifiedTrade: number;
    walletsShared: number;
  };
  feedback: {
    total: number;
    useful: { up: number; down: number };
    accurate: { up: number; down: number };
    withComment: number;
    byBriefSource: Record<string, number>;
  };
};

export function summarize(events: UsageEventRow[], feedback: FeedbackRow[]): EvidenceSummary {
  const byEvent: Record<string, number> = {};
  const days = new Map<string, Set<string>>();
  const flows = new Map<string, Set<string>>();
  const verified = new Set<string>();
  const wallets = new Set<string>();
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for (const e of events) {
    byEvent[e.event] = (byEvent[e.event] || 0) + 1;
    if (!firstAt || e.t < firstAt) firstAt = e.t;
    if (!lastAt || e.t > lastAt) lastAt = e.t;
    if (!days.has(e.anonId)) days.set(e.anonId, new Set());
    days.get(e.anonId)!.add(istDay(e.t));
    if (e.event !== "visit") {
      if (!flows.has(e.anonId)) flows.set(e.anonId, new Set());
      flows.get(e.anonId)!.add(e.event);
    }
    if (e.event === "trade_verified") verified.add(e.anonId);
    if (e.wallet) wallets.add(e.wallet);
  }
  const fb: EvidenceSummary["feedback"] = {
    total: feedback.length,
    useful: { up: 0, down: 0 },
    accurate: { up: 0, down: 0 },
    withComment: 0,
    byBriefSource: {},
  };
  for (const f of feedback) {
    if (f.useful) fb.useful[f.useful] += 1;
    if (f.accurate) fb.accurate[f.accurate] += 1;
    if (f.comment) fb.withComment += 1;
    fb.byBriefSource[f.briefSource] = (fb.byBriefSource[f.briefSource] || 0) + 1;
  }
  return {
    events: { total: events.length, byEvent, firstAt, lastAt },
    visitors: {
      unique: days.size,
      returning: [...days.values()].filter((d) => d.size >= 2).length,
      multiWorkflow: [...flows.values()].filter((f) => f.size >= 2).length,
      verifiedTrade: verified.size,
      walletsShared: wallets.size,
    },
    feedback: fb,
  };
}
