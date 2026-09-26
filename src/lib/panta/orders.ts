/**
 * Orders adapter: primary buy quote → build → submit → verify
 * (docs.panta.market api-reference/orders/*). Write-path responses are parsed
 * strictly (parseOrThrow): the desk never signs a build it could not validate.
 */

import type { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { Json } from "@/lib/types";
import {
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
import { validatePantaInstructions, type InstructionCheck } from "./instructions";

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
 * Cross-check a build against the active quote and the connected wallet,
 * then run the instruction allowlist (./instructions). Any mismatch blocks
 * signing.
 */
export function checkBuild(
  built: PrimaryBuild,
  quote: Quote | null,
  wallet: PublicKey,
): InstructionCheck {
  const w = wallet.toBase58();
  if (built.wallet && built.wallet !== w) {
    return { ok: false, reason: "Build wallet does not match the connected wallet. Signing blocked." };
  }
  if (quote) {
    if (built.quoteId && built.quoteId !== quote.quoteId) {
      return { ok: false, reason: "Build does not match the active quote. Signing blocked." };
    }
    if (built.marketId && built.marketId !== quote.marketId) {
      return { ok: false, reason: "Build market differs from the quoted market. Signing blocked." };
    }
    if (built.side && built.side !== quote.side) {
      return { ok: false, reason: "Build side differs from the quoted side. Signing blocked." };
    }
  }
  return validatePantaInstructions(built.instructions, wallet);
}

// ---------------------------------------------------------------------------
// Browser calls (via /api/panta)
// ---------------------------------------------------------------------------

export async function requestQuote(
  input: { wallet: string; marketId: string; side: Side; amountUsdc: string },
  userId?: string,
): Promise<{ quote: Quote; raw: Json }> {
  const body: Record<string, string> = { ...input };
  if (userId) body.userId = userId;
  const { data, raw } = await pantaFetch("/primaryorderquote/", { method: "POST", userId, body });
  return { quote: parseQuote(data), raw };
}

export async function requestBuild(
  input: { quoteId: string; wallet: string; maxSlippageBps: number },
  userId?: string,
): Promise<{ build: PrimaryBuild; raw: Json }> {
  const body: Record<string, string | number> = { ...input };
  if (userId) body.userId = userId;
  const { data, raw } = await pantaFetch("/primaryorderbuild/", { method: "POST", userId, body });
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
