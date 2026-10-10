/**
 * Positions adapter: GET /positions/?wallet= → Position[]
 * (docs.panta.market api-reference/positions: `shares` is a human-readable
 * share quantity).
 *
 * Fail closed: a response is accepted only when it is complete and well
 * formed. A missing / non-array `positions`, a row that doesn't parse, or a
 * response for another wallet is UNVERIFIED and throws
 * PositionsUnverifiedError. It never becomes an empty portfolio (which would
 * read as "no positions" / "nothing to claim" and corrupt trade-reconcile
 * baselines). Only `{ positions: [] }` is a confirmed empty wallet.
 */

import { z } from "@/lib/zod";
import { devWarn, numish, optBool, optStr, pantaFetch, parseOrNull, parseSide, toStrOrNull } from "./client";
import type { Position } from "./domain";
import { humanAmount } from "./normalize";

const RawPositionSchema = z.looseObject({
  marketId: z.string().min(1),
  category: optStr,
  side: optStr,
  shares: numish,
  phase: optStr,
  claimable: optBool,
  claimed: optBool,
  outcome: optStr,
  title: optStr,
  // Valuation (live responses; see domain.ts PositionValuationFields).
  price: numish,
  priceSource: optStr,
  valuationStatus: optStr,
  currentValueUsdc: numish,
  currentValueUsdcBase: numish,
  claimedPayoutUsdc: numish,
});

const RawPositionsSchema = z.looseObject({
  wallet: optStr,
  // No .catch([]): a missing or non-array list is malformed, not empty.
  positions: z.array(z.unknown()),
});

export const POSITIONS_UNVERIFIED_TEXT = "Positions couldn't be verified";

/** The positions response couldn't be trusted (malformed or incomplete). */
export class PositionsUnverifiedError extends Error {
  constructor(
    public readonly kind: "malformed" | "incomplete",
    public readonly reason: string,
  ) {
    super(`${POSITIONS_UNVERIFIED_TEXT}: Panta's response was ${kind === "malformed" ? "malformed" : "incomplete"} (${reason}).`);
    this.name = "PositionsUnverifiedError";
  }
}

export type PositionsParse =
  | { kind: "ok"; positions: Position[] }
  | { kind: "malformed"; reason: string }
  | { kind: "incomplete"; positions: Position[]; dropped: number; reason: string };

/** Classify a /positions/ response (pure; never throws). */
export function parsePositionsResult(raw: unknown, expectedWallet?: string | null): PositionsParse {
  const page = parseOrNull(RawPositionsSchema, raw, "positions");
  if (!page) return { kind: "malformed", reason: "no positions list" };
  if (expectedWallet && page.wallet && page.wallet !== expectedWallet) return { kind: "malformed", reason: "response is for a different wallet" };
  const out: Position[] = [];
  let dropped = 0;
  for (const row of page.positions) {
    const r = RawPositionSchema.safeParse(row);
    if (!r.success) {
      dropped++;
      continue;
    }
    const p = r.data;
    const shares = p.shares == null ? "" : String(p.shares);
    out.push({
      marketId: p.marketId,
      category: p.category || null,
      side: parseSide(p.side),
      shares,
      sharesNum: humanAmount(shares),
      phase: (p.phase || "").toLowerCase(),
      claimable: p.claimable === true,
      claimed: p.claimed === true,
      outcome: p.outcome || null,
      title: p.title || null,
      valuation: {
        price: toStrOrNull(p.price),
        priceSource: p.priceSource || null,
        status: p.valuationStatus ? p.valuationStatus.toLowerCase() : null,
        currentValueUsdc: toStrOrNull(p.currentValueUsdc),
        currentValueUsdcBase: toStrOrNull(p.currentValueUsdcBase),
        claimedPayoutUsdc: toStrOrNull(p.claimedPayoutUsdc),
      },
    });
  }
  if (dropped > 0) {
    devWarn(`positions: ${dropped} row(s) didn't parse; the response is treated as incomplete`);
    return { kind: "incomplete", positions: out, dropped, reason: `${dropped} of ${page.positions.length} rows unreadable` };
  }
  return { kind: "ok", positions: out };
}

/** Verified positions, or PositionsUnverifiedError (never a fabricated empty list). */
export function parsePositions(raw: unknown, expectedWallet?: string | null): Position[] {
  const r = parsePositionsResult(raw, expectedWallet);
  if (r.kind === "ok") return r.positions;
  throw new PositionsUnverifiedError(r.kind, r.reason);
}

/** Upstream failures throw (pantaFetch); malformed / incomplete responses throw PositionsUnverifiedError. */
export async function fetchPositions(wallet: string): Promise<Position[]> {
  const { data } = await pantaFetch("/positions/", { query: { wallet } });
  return parsePositions(data, wallet);
}
