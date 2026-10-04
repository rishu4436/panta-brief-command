/**
 * Attribution adapter: POST /trades/ (report) and GET /account/trades/
 * (partner ledger).
 *
 * Vocabulary used across the desk:
 * - "reported"   → POST /trades/ accepted, attribution not confirmed yet
 * - "attributed" → POST /trades/ returned `processed` ("when attribution is
 *                  stored", docs trades/report) or the signature is listed in
 *                  GET /account/trades/
 */

import { z } from "@/lib/zod";
import type { Json } from "@/lib/types";
import { ApiError, devWarn, numish, optNum, optStr, pantaFetch, parseOrNull } from "./client";
import type {
  AccountTrades,
  AttributionState,
  TradeKind,
  TradeReport,
  TradeReportStatus,
} from "./domain";
import { normalizeAccountTrade } from "./normalize";

/** `processed` is the only POST /trades/ status treated as definitive. */
export function attributionFromReport(status: string | null | undefined): AttributionState {
  return String(status || "").toLowerCase() === "processed" ? "attributed" : "reported";
}

const RawReportSchema = z.looseObject({
  signature: optStr,
  status: optStr,
  marketId: optStr,
  wallet: optStr,
  side: optStr,
  kind: optStr,
});

export function parseTradeReport(raw: unknown, signature: string): TradeReport {
  const r = parseOrNull(RawReportSchema, raw, "trade report");
  return {
    signature: r?.signature || signature,
    status: (r?.status || "").toLowerCase() as TradeReportStatus,
    marketId: r?.marketId ?? undefined,
    wallet: r?.wallet ?? undefined,
    side: r?.side ?? undefined,
    kind: (r?.kind?.toLowerCase() as TradeKind | undefined) ?? undefined,
  };
}

const RawAccountTradeSchema = z.looseObject({
  signature: z.string().min(1),
  wallet: optStr,
  marketId: optStr,
  side: optStr,
  kind: optStr,
  amountUsdc: numish,
  amountUsdcBase: numish,
  status: optStr,
  createdAt: optStr,
});

const RawSummarySchema = z.looseObject({
  total: optNum,
  activityTotal: optNum,
  buys: optNum,
  claims: optNum,
  volumeUsdc: numish,
  tradeVolumeUsdc: numish,
  activityValueUsdc: numish,
  unattributed: optNum,
  byKind: z.record(z.string(), z.number()).nullish().catch(undefined),
});

const RawAccountTradesSchema = z.looseObject({
  summary: z.unknown().optional(),
  items: z.array(z.unknown()).catch([]),
});

const s = (v: string | number | null | undefined) => (v == null ? undefined : String(v));

export function parseAccountTrades(raw: unknown): AccountTrades {
  const page = parseOrNull(RawAccountTradesSchema, raw, "account trades");
  if (!page) return { summary: null, items: [] };
  const items = [];
  for (const row of page.items) {
    const r = RawAccountTradeSchema.safeParse(row);
    if (r.success) items.push(normalizeAccountTrade(r.data));
    else devWarn("account trades: dropped a row without a signature");
  }
  const sum = page.summary == null ? null : RawSummarySchema.safeParse(page.summary);
  const summary =
    sum && sum.success
      ? {
          total: sum.data.total ?? undefined,
          activityTotal: sum.data.activityTotal ?? undefined,
          buys: sum.data.buys ?? undefined,
          claims: sum.data.claims ?? undefined,
          volumeUsdc: s(sum.data.volumeUsdc),
          tradeVolumeUsdc: s(sum.data.tradeVolumeUsdc),
          activityValueUsdc: s(sum.data.activityValueUsdc),
          unattributed: sum.data.unattributed ?? undefined,
          byKind: sum.data.byKind ?? undefined,
        }
      : null;
  return { summary, items };
}

export type TradeReportInput = {
  signature: string;
  wallet: string;
  marketId: string;
  quoteId?: string;
  clientOrderId?: string;
};

export async function reportTrade(
  input: TradeReportInput,
  userId?: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ report: TradeReport; state: AttributionState; raw: Json }> {
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) if (v) body[k] = v;
  if (userId) body.userId = userId;
  const { data, raw } = await pantaFetch("/trades/", { method: "POST", userId, body, signal: opts.signal });
  const report = parseTradeReport(data, input.signature);
  return { report, state: attributionFromReport(report.status), raw };
}

// ---------------------------------------------------------------------------
// Bounded retry for the primary-buy attribution report (POST /trades/).
//
// Panta intermittently answers a valid report with 400 INVALID_MARKET_PARAMS
// in bursts (seen 3–5 Oct 2026: ~8–13 s windows; the real 3rd buy's report hit
// one). Only that exact answer is retried: HTTP 400 from Panta with body code
// INVALID_MARKET_PARAMS. Everything else surfaces immediately, as before
// (other 400s, 401/403/404, 429, 5xx, network, malformed bodies).
//
// Policy: 4 attempts total, waits 1.5 s, 3 s, 6 s (+ ≤300 ms jitter), so the
// last attempt lands ~10.5–11.4 s after the first — long enough to outlast
// most observed bursts, while costing at most 4 of Panta's shared 30/min key
// budget per trade (quote/build retries use ≤8 more). Longer gaps would keep
// the user waiting with no benefit once a burst is that long; they get a
// manual "Retry attribution" instead. AbortSignal cancels the waits.
// Every attempt sends the identical payload object.
// ---------------------------------------------------------------------------

export const ATTRIBUTION_RETRY_DELAYS_MS = [1500, 3000, 6000] as const;
export const ATTRIBUTION_RETRY_JITTER_MS = 300;
export const ATTRIBUTION_MAX_ATTEMPTS = ATTRIBUTION_RETRY_DELAYS_MS.length + 1;
/** Code surfaced when Panta's transient refusal outlived every attempt. */
export const ATTRIBUTION_UNAVAILABLE = "ATTRIBUTION_UNAVAILABLE";

export function isTransientAttributionRefusal(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 400) return false;
  const b = e.body;
  return !!b && typeof b === "object" && !Array.isArray(b) && (b as { code?: unknown }).code === "INVALID_MARKET_PARAMS";
}

export function isAttributionUnavailable(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  const b = e.body;
  return !!b && typeof b === "object" && !Array.isArray(b) && (b as { code?: unknown }).code === ATTRIBUTION_UNAVAILABLE;
}

export type AttributionRetryOptions = {
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number }) => void;
  /** Tests only. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  report?: typeof reportTrade;
};

function abortError(signal?: AbortSignal): Error {
  const r = signal?.reason;
  if (r instanceof Error) return r;
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * POST /trades/ for a confirmed, verified trade, retrying only Panta's
 * transient INVALID_MARKET_PARAMS. Throws ApiError(ATTRIBUTION_UNAVAILABLE)
 * when every attempt got that refusal; any other error is rethrown as is.
 */
export async function reportTradeWithRetry(
  input: Readonly<TradeReportInput>,
  userId: string | undefined,
  opts: AttributionRetryOptions = {},
): Promise<{ report: TradeReport; state: AttributionState; raw: Json }> {
  const sleep = opts.sleep ?? abortableSleep;
  const random = opts.random ?? Math.random;
  const report = opts.report ?? reportTrade;
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    try {
      return await report(input, userId, { signal: opts.signal });
    } catch (e) {
      if (!isTransientAttributionRefusal(e) || opts.signal?.aborted) throw e;
      if (attempt >= ATTRIBUTION_MAX_ATTEMPTS) {
        throw new ApiError(400, { code: ATTRIBUTION_UNAVAILABLE, upstreamCode: "INVALID_MARKET_PARAMS", attempts: ATTRIBUTION_MAX_ATTEMPTS });
      }
      const delayMs = ATTRIBUTION_RETRY_DELAYS_MS[attempt - 1] + Math.floor(random() * ATTRIBUTION_RETRY_JITTER_MS);
      opts.onRetry?.({ attempt: attempt + 1, maxAttempts: ATTRIBUTION_MAX_ATTEMPTS, delayMs });
      await sleep(delayMs, opts.signal);
    }
  }
}

export async function fetchAccountTrades(params: {
  limit?: number;
  kind?: "buy" | "claim" | "";
}): Promise<AccountTrades> {
  const { data } = await pantaFetch("/account/trades/", {
    query: {
      limit: params.limit ? String(params.limit) : undefined,
      kind: params.kind || undefined,
    },
  });
  return parseAccountTrades(data);
}

/** True when `signature` is listed in the attribution ledger. */
export async function isInLedger(signature: string, kind: "buy" | "claim"): Promise<boolean> {
  const { items } = await fetchAccountTrades({ limit: 50, kind });
  return items.some((row) => row.signature === signature);
}
