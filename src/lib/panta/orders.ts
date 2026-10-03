/**
 * Orders adapter: primary buy quote → build → submit → verify
 * (docs.panta.market api-reference/orders/*). Write-path responses are parsed
 * strictly (parseOrThrow): the desk never signs a build it could not validate.
 */

import type { PublicKey } from "@solana/web3.js";
import { z } from "@/lib/zod";
import type { Json } from "@/lib/types";
import {
  ApiError,
  InstructionSchema,
  numish,
  optNum,
  optStr,
  pantaFetch,
  parseOrNull,
  parseOrThrow,
  parseSide,
} from "./client";
import type { OrderStatus, OrderVerify, PrimaryBuild, Quote, Side } from "./domain";
import { verifyPrimaryBuyBuild, type PrimaryBuyCheck } from "./primary-order";

const dec = numish.transform((v) => (v == null ? "" : String(v)));

const RawQuoteSchema = z.looseObject({
  quoteId: z.string().min(1),
  marketId: z.string().min(1),
  side: z.string(),
  amountUsdc: dec,
  shares: dec,
  avgPrice: dec,
  feeUsdc: dec,
  expiresAt: optStr,
  blockhashExpiryHintSec: optNum,
});

const RawBuildSchema = z.looseObject({
  orderId: z.string().min(1),
  quoteId: optStr,
  wallet: optStr,
  marketId: optStr,
  side: optStr,
  amountUsdc: dec,
  expectedShares: dec,
  feeUsdc: dec,
  status: optStr,
  instructions: z.array(InstructionSchema),
  recentBlockhash: z.string().min(32),
  lastValidBlockHeight: optNum,
  expiresAt: optStr,
});

const RawStatusSchema = z.looseObject({
  orderId: optStr,
  status: optStr,
  signature: optStr,
});

export function parseQuote(raw: unknown): Quote {
  const q = parseOrThrow(RawQuoteSchema, raw, "primary quote");
  const side = parseSide(q.side);
  if (!side) throw new Error(`Quote returned an unknown side (${q.side}).`);
  return {
    quoteId: q.quoteId,
    marketId: q.marketId,
    side,
    amountUsdc: q.amountUsdc,
    shares: q.shares,
    avgPrice: q.avgPrice,
    feeUsdc: q.feeUsdc,
    expiresAt: q.expiresAt || "",
    blockhashExpiryHintSec: q.blockhashExpiryHintSec ?? undefined,
  };
}

export function parseBuild(raw: unknown): PrimaryBuild {
  const b = parseOrThrow(RawBuildSchema, raw, "primary build");
  return {
    orderId: b.orderId,
    quoteId: b.quoteId || "",
    wallet: b.wallet || "",
    marketId: b.marketId || "",
    side: parseSide(b.side),
    amountUsdc: b.amountUsdc,
    expectedShares: b.expectedShares,
    feeUsdc: b.feeUsdc,
    status: (b.status || "built").toLowerCase() as OrderStatus,
    instructions: b.instructions,
    recentBlockhash: b.recentBlockhash,
    lastValidBlockHeight: b.lastValidBlockHeight ?? undefined,
    expiresAt: b.expiresAt ?? undefined,
  };
}

export function parseOrderStatus(raw: unknown): OrderVerify {
  const r = parseOrNull(RawStatusSchema, raw, "order status");
  return {
    orderId: r?.orderId ?? undefined,
    status: r?.status ? (r.status.toLowerCase() as OrderStatus) : null,
    signature: r?.signature ?? undefined,
  };
}

/**
 * Cross-check a build against the approved quote and the connected wallet,
 * then decode and verify the instructions (./primary-order). Any missing or
 * mismatched field blocks signing (fail closed).
 */
export function checkBuild(
  built: PrimaryBuild,
  quote: Quote | null,
  wallet: PublicKey,
  maxSlippageBps: number | null | undefined,
): PrimaryBuyCheck {
  return verifyPrimaryBuyBuild(built, quote, wallet, maxSlippageBps);
}

// ---------------------------------------------------------------------------
// Browser calls (via /api/panta)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bounded retry for quote + build only.
//
// Panta's live API intermittently answers a valid quote/build with 4xx
// {"code":"INVALID_MARKET_PARAMS"} in short bursts (3 Oct 2026: 20 sequential
// direct quotes at 1 s spacing → 3 failures; at other times 6/6 for a few
// seconds; same with and without our proxy). Quote and build are retried on
// that code, on 502/503/504 and on network errors: 4 attempts total, backoff
// ~400 / 900 / 1600 ms + ≤150 ms jitter, cancelled by AbortSignal.
// Never retried: 429 (incl. our proxy's per-IP limit), any other code, an
// abort, a schema error, and submit / verify / trade report. Worst case 4
// calls per click keeps a user well inside the proxy's quote 30/min and
// build 20/min. A build retry is safe: nothing is signed, the same quoteId is
// reused, and the caller runs every strict check on whatever build finally
// comes back.
// ---------------------------------------------------------------------------

export const PANTA_RETRY_DELAYS_MS = [400, 900, 1600] as const;
export const PANTA_RETRY_JITTER_MS = 150;
export const PANTA_MAX_ATTEMPTS = PANTA_RETRY_DELAYS_MS.length + 1;
export const PANTA_TRANSIENT_CODE = "INVALID_MARKET_PARAMS";
/** Code surfaced when the transient INVALID_MARKET_PARAMS persists after every attempt. */
export const PANTA_PRICING_UNAVAILABLE = "PANTA_PRICING_UNAVAILABLE";

export type RetryOptions = {
  signal?: AbortSignal;
  /** Called before each retry wait (attempt = the one about to run, 2..4). */
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void;
  /** Tests only. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

function bodyObject(e: ApiError): Record<string, Json> {
  const b = e.body;
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, Json>) : {};
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";
}

/** Reason string when `e` is worth retrying, else null. */
export function transientReason(e: unknown): string | null {
  if (isAbort(e)) return null;
  if (e instanceof ApiError) {
    if (e.status === 429) return null;
    if (e.status >= 400 && e.status < 500 && bodyObject(e).code === PANTA_TRANSIENT_CODE) return PANTA_TRANSIENT_CODE;
    if (e.status === 502 || e.status === 503 || e.status === 504) return `HTTP ${e.status}`;
    return null;
  }
  // fetch() rejects with TypeError on network failure.
  if (e instanceof TypeError) return "network error";
  return null;
}

function abortError(signal?: AbortSignal): Error {
  const r = signal?.reason;
  if (r instanceof Error) return r;
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
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

export async function withPantaRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    try {
      return await fn();
    } catch (e) {
      const reason = transientReason(e);
      if (!reason || opts.signal?.aborted) throw e;
      if (attempt >= PANTA_MAX_ATTEMPTS) {
        if (reason === PANTA_TRANSIENT_CODE && e instanceof ApiError) {
          const b = bodyObject(e);
          throw new ApiError(e.status, {
            code: PANTA_PRICING_UNAVAILABLE,
            upstreamCode: PANTA_TRANSIENT_CODE,
            attempts: PANTA_MAX_ATTEMPTS,
            ...(b.detail != null ? { upstreamDetail: b.detail } : {}),
          });
        }
        throw e;
      }
      const delayMs = PANTA_RETRY_DELAYS_MS[attempt - 1] + Math.floor(random() * PANTA_RETRY_JITTER_MS);
      opts.onRetry?.({ attempt: attempt + 1, maxAttempts: PANTA_MAX_ATTEMPTS, delayMs, reason });
      await sleep(delayMs, opts.signal);
    }
  }
}

export async function requestQuote(
  input: { wallet: string; marketId: string; side: Side; amountUsdc: string },
  userId?: string,
  retry: RetryOptions = {},
): Promise<{ quote: Quote; raw: Json }> {
  const body: Record<string, string> = { ...input };
  if (userId) body.userId = userId;
  const { data, raw } = await withPantaRetry(
    () => pantaFetch("/primaryorderquote/", { method: "POST", userId, body, signal: retry.signal }),
    retry,
  );
  return { quote: parseQuote(data), raw };
}

/**
 * Every attempt sends the same quoteId. Returns the parsed build only; the
 * caller must still run checkBuild + the quote guard on it before signing.
 */
export async function requestBuild(
  input: { quoteId: string; wallet: string; maxSlippageBps: number },
  userId?: string,
  retry: RetryOptions = {},
): Promise<{ build: PrimaryBuild; raw: Json }> {
  const body: Record<string, string | number> = { ...input };
  if (userId) body.userId = userId;
  const { data, raw } = await withPantaRetry(
    () => pantaFetch("/primaryorderbuild/", { method: "POST", userId, body, signal: retry.signal }),
    retry,
  );
  return { build: parseBuild(data), raw };
}

export async function submitOrder(input: {
  orderId: string;
  signature: string;
  wallet: string;
}): Promise<{ result: OrderVerify; raw: Json }> {
  const { data, raw } = await pantaFetch("/primaryordersubmit/", { method: "POST", body: input });
  return { result: parseOrderStatus(data), raw };
}

export async function verifyOrder(input: {
  orderId: string;
  signature?: string | null;
  wallet: string;
}): Promise<{ result: OrderVerify; raw: Json }> {
  const body = {
    orderId: input.orderId,
    wallet: input.wallet,
    ...(input.signature ? { signature: input.signature } : {}),
  };
  const { data, raw } = await pantaFetch("/primaryorderverify/", { method: "POST", body });
  return { result: parseOrderStatus(data), raw };
}
