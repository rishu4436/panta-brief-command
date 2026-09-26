/**
 * Positions adapter: GET /positions/?wallet= → Position[]
 * (docs.panta.market api-reference/positions: `shares` is a human-readable
 * share quantity). Read path: malformed rows are dropped with a dev warning.
 */

import { z } from "zod";
import { devWarn, numish, optBool, optStr, pantaFetch, parseOrNull, parseSide } from "./client";
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
});

const RawPositionsSchema = z.looseObject({
  wallet: optStr,
  positions: z.array(z.unknown()).catch([]),
});

export function parsePositions(raw: unknown): Position[] {
  const page = parseOrNull(RawPositionsSchema, raw, "positions");
  if (!page) return [];
  const out: Position[] = [];
  for (const row of page.positions) {
    const r = RawPositionSchema.safeParse(row);
    if (!r.success) {
      devWarn("positions: dropped a row without a marketId");
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
    });
  }
  return out;
}

export async function fetchPositions(wallet: string): Promise<Position[]> {
  const { data } = await pantaFetch("/positions/", { query: { wallet } });
  return parsePositions(data);
}
