/**
 * Browser-side Panta client. Calls go to the allowlisted Next.js proxy
 * (/api/panta/*); the server attaches its own X-Api-Key, so this client never
 * sends or sees a key. Also hosts the zod parse helpers every adapter uses.
 */

import { z } from "zod";
import type { Json } from "@/lib/types";
import { isValidAttributionRef } from "./routes";

export class ApiError extends Error {
  status: number;
  body: Json;

  constructor(status: number, body: Json) {
    const code =
      body && typeof body === "object" && !Array.isArray(body) && "code" in body
        ? String((body as { code: unknown }).code)
        : `HTTP ${status}`;
    super(code);
    this.status = status;
    this.body = body;
  }
}

/** Thrown when a write-path response (quote/build/claim) cannot be trusted. */
export class SchemaError extends Error {
  constructor(label: string, detail: string) {
    super(`${label}: unexpected response shape from Panta (${detail})`);
  }
}

export type FetchOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Attribution reference (X-User-Id), sent only when it passes the proxy's charset check. */
  userId?: string;
  signal?: AbortSignal;
};

/** Raw proxy call. Adapters parse `data`; `raw` is kept for the debug drawer. */
export async function pantaFetch(
  path: string,
  options: FetchOptions = {},
): Promise<{ data: unknown; raw: Json }> {
  const method = options.method || "GET";
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.query || {})) {
    if (v !== undefined && v !== "") filtered[k] = v;
  }
  const qs = Object.keys(filtered).length ? `?${new URLSearchParams(filtered)}` : "";
  // Adapters keep Panta's documented trailing-slash paths; the proxy re-adds
  // the slash upstream, so strip it here to skip Next's 308 redirect hop.
  const clean = (path.startsWith("/") ? path : `/${path}`).replace(/\/+$/, "");
  const url = `/api/panta${clean}${qs}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  const userId = options.userId?.trim();
  if (userId && isValidAttributionRef(userId)) headers["X-User-Id"] = userId;

  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { method, headers, body, signal: options.signal });
  const text = await res.text();
  let parsed: Json = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) throw new ApiError(res.status, parsed);
  return { data: parsed, raw: parsed };
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

const warned = new Set<string>();

/** Development-only warning (deduped per message) — production stays quiet. */
export function devWarn(message: string, detail?: unknown) {
  if (process.env.NODE_ENV === "production") return;
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[panta] ${message}`, detail ?? "");
}

/**
 * Read path: parse or degrade. Returns null (and warns in dev) on mismatch so
 * a page renders an empty/"unavailable" state instead of crashing.
 */
export function parseOrNull<T>(schema: z.ZodType<T>, raw: unknown, label: string): T | null {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  devWarn(`${label}: response did not match schema; degrading`, z.prettifyError(r.error));
  return null;
}

/**
 * Write path (anything that leads to a wallet signature): parse or throw.
 * Signing must never proceed on a response we could not validate.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  devWarn(`${label}: response did not match schema`, z.prettifyError(r.error));
  throw new SchemaError(label, r.error.issues[0]?.message || "invalid");
}

// Lenient field schemas: a wrong-typed optional field becomes undefined
// instead of failing the whole object. Unknown fields pass through.
export const optStr = z.string().nullish().catch(undefined);
export const optNum = z.number().nullish().catch(undefined);
export const optBool = z.boolean().nullish().catch(undefined);
/** Decimal that Panta sends as string or number. */
export const numish = z.union([z.string(), z.number()]).nullish().catch(undefined);

export function toStrOrNull(v: string | number | null | undefined): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  return Number.isFinite(Number(s)) ? s : null;
}

export function parseSide(v: unknown): "yes" | "no" | null {
  const s = String(v ?? "").toLowerCase();
  if (s === "yes" || s === "y") return "yes";
  if (s === "no" || s === "n") return "no";
  return null;
}

/** Instruction payloads are security-relevant: strict shape, no catch. */
export const InstructionSchema = z.looseObject({
  programId: z.string().min(32).max(44),
  data: z.string(),
  accounts: z.array(
    z.looseObject({
      pubkey: z.string().min(32).max(44),
      isSigner: z.boolean(),
      isWritable: z.boolean(),
    }),
  ),
});
