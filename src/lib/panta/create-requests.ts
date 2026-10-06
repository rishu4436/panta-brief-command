/**
 * Route-specific request validation for the four create routes of the
 * /api/panta proxy. Runs server-side BEFORE anything is forwarded with
 * PANTA_API_KEY. Strict objects: unknown keys (oracle, paymentUsdc, …) are
 * rejected, not passed through.
 */

import { z } from "@/lib/zod";
import { BASE58_PUBKEY_RE } from "./routes";
import { CREATE_CATEGORIES, CREATE_LIMITS, isAllowedImageUrl, isHttpsUrl } from "./create-rules";

const CREATE_ID_RE = /^cr_[A-Za-z0-9]{8,64}$/;
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const UNIX_MIN = 1_577_836_800;
const UNIX_MAX = 4_102_444_800;

const unix = z.number().int().min(UNIX_MIN).max(UNIX_MAX);
const text = (min: number, max: number) => z.string().min(min).max(max);

const QuoteBody = z
  .strictObject({
    wallet: z.string().regex(BASE58_PUBKEY_RE),
    question: text(1, CREATE_LIMITS.questionMax),
    resolutionRule: text(1, CREATE_LIMITS.ruleMax),
    sourcesOfTruth: z.array(z.string().refine((s) => isHttpsUrl(s), "must be a public https URL")).min(1).max(CREATE_LIMITS.sourcesMax),
    category: z.enum(CREATE_CATEGORIES),
    startTime: unix,
    endTime: unix,
    resolutionTime: unix,
    marketType: z.enum(["standard", "breaking"]),
    title: text(1, CREATE_LIMITS.titleMax).optional(),
    description: text(1, CREATE_LIMITS.descriptionMax).optional(),
    imageUrl: z.string().refine((s) => isAllowedImageUrl(s), "must be a Panta image-upload URL"),
    region: text(1, CREATE_LIMITS.regionMax).optional(),
    eventInProgress: z.boolean().optional(),
  })
  .superRefine((b, ctx) => {
    if (!(b.startTime < b.endTime && b.endTime <= b.resolutionTime)) {
      ctx.addIssue({ code: "custom", path: ["startTime"], message: "requires startTime < endTime <= resolutionTime" });
    }
    if (b.eventInProgress !== undefined && b.marketType !== "breaking") {
      ctx.addIssue({ code: "custom", path: ["eventInProgress"], message: "only allowed for breaking markets" });
    }
  });

const BuildBody = z.strictObject({ createId: z.string().regex(CREATE_ID_RE), wallet: z.string().regex(BASE58_PUBKEY_RE) });
const RegisterBody = z.strictObject({ createId: z.string().regex(CREATE_ID_RE), signature: z.string().regex(SIGNATURE_RE) });
const ImageUploadBody = z.strictObject({});

export type CreateRouteValidator = "create.imageUpload" | "create.quote" | "create.build" | "create.register";

const SCHEMAS: Record<CreateRouteValidator, z.ZodType> = {
  "create.imageUpload": ImageUploadBody,
  "create.quote": QuoteBody,
  "create.build": BuildBody,
  "create.register": RegisterBody,
};

export function validateCreateRequest(id: CreateRouteValidator, body: unknown): { ok: true; body: unknown } | { ok: false; detail: string } {
  const r = SCHEMAS[id].safeParse(body);
  if (r.success) return { ok: true, body: r.data };
  const issue = r.error.issues[0];
  const path = issue?.path?.length ? issue.path.join(".") : "body";
  return { ok: false, detail: `${path}: ${issue?.message ?? "invalid"}`.slice(0, 160) };
}

/** Panta account identifiers that create responses carry; never needed by the browser. */
const STRIP_RESPONSE_KEYS = ["userId", "apiKeyId"] as const;

export function sanitizeCreateResponse(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return text;
  const o = { ...(parsed as Record<string, unknown>) };
  for (const k of STRIP_RESPONSE_KEYS) delete o[k];
  return JSON.stringify(o);
}
