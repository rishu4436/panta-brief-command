/**
 * Panta response normalizers — the single place that decides units.
 *
 * Rule: units come from the field-name contract, never from magnitude.
 *   - `*Base` fields are 6-decimal base units → divide by 1e6.
 *   - Plain `*Usdc` / `shares` fields are human-readable decimals → use as-is.
 * USDC and Panta outcome shares both use 6 decimals on-chain.
 *
 * Sources (checked 2026-09-26):
 *   [docs-amounts]   https://docs.panta.market/ ("Amounts" table)
 *   [docs-orders]    https://docs.panta.market/api-reference/orders/overview
 *   [docs-mtrades]   https://docs.panta.market/api-reference/markets/trades
 *   [docs-acct]      https://docs.panta.market/api-reference/account/trades
 *   [docs-positions] https://docs.panta.market/api-reference/positions
 *   [docs-list]      https://docs.panta.market/api-reference/markets/list
 *   [live]           live GET /markets/{id}/trades/ + on-chain PrimaryOrderUsdc
 *                    log for the same signature (see normalizePantaTrade).
 */

import type { AccountTrade, Market, Side, Trade } from "./domain";

type Numish = string | number | null | undefined;

/** Raw tape row as Panta sends it (docs table + live extras shares/sharesBase). */
export type RawTradeRow = {
  id?: string | number | null;
  marketId?: string | null;
  wallet?: string | null;
  isPrimary?: boolean | null;
  yesAmount?: Numish;
  noAmount?: Numish;
  feePaid?: Numish;
  blockTime?: number | null;
  signature?: string | null;
  kind?: string | null;
  side?: string | null;
  amountUsdc?: Numish;
  amountUsdcBase?: Numish;
  shares?: Numish;
  sharesBase?: Numish;
};

/** Raw attribution row (GET /account/trades/). */
export type RawAccountTrade = {
  signature: string;
  wallet?: string | null;
  marketId?: string | null;
  side?: string | null;
  kind?: string | null;
  amountUsdc?: Numish;
  amountUsdcBase?: Numish;
  status?: string | null;
  createdAt?: string | null;
};

export const PANTA_DECIMALS = 6;
const BASE = 10 ** PANTA_DECIMALS;

/** Parse a human-readable decimal field. No unit conversion. */
export function humanAmount(v: Numish): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Convert a `*Base` (6-decimal base unit) field to human units. Always ÷ 1e6. */
export function fromBaseUnits(v: Numish): number | null {
  const n = humanAmount(v);
  return n == null ? null : n / BASE;
}

export type PantaSide = Side;

function parseSide(v: unknown): Side | null {
  const s = String(v ?? "").toLowerCase();
  if (s === "yes" || s === "y") return "yes";
  if (s === "no" || s === "n") return "no";
  return null;
}

// ---------------------------------------------------------------------------
// Trades (catalog tape: GET /markets/{id}/trades/)
// ---------------------------------------------------------------------------

/** @deprecated use Trade from ./domain */
export type NormalizedTrade = Trade;

export function normalizePantaTrade(raw: RawTradeRow): Trade {
  const t = raw;

  // shares: human decimal string; sharesBase: 6-dec base units. [live] Both are
  // returned by GET /markets/{id}/trades/ (e.g. shares "48.647771",
  // sharesBase "48647771"), matching on-chain `minted=48647771` in the
  // PrimaryOrderUsdc log of that signature.
  const shares = humanAmount(t.shares) ?? fromBaseUnits(t.sharesBase);

  // amountUsdc: human decimal; amountUsdcBase: base units. [docs-acct] documents
  // this pair for attribution rows; tape rows use the same names (currently null).
  const amountUsdc = humanAmount(t.amountUsdc) ?? fromBaseUnits(t.amountUsdcBase);

  // yesAmount / noAmount: AMBIGUOUS. [docs-mtrades] calls them "Share amounts"
  // with a human example ("10.00"), but [live] returns base units
  // (yesAmount 48647771.0 == sharesBase). Choice: never derive a displayed
  // magnitude from them — use only for unit-free side inference (yes vs no).
  let side = parseSide(t.side);
  if (!side) {
    const y = humanAmount(t.yesAmount) ?? 0;
    const n = humanAmount(t.noAmount) ?? 0;
    if (y > n) side = "yes";
    else if (n > y) side = "no";
  }

  // feePaid: units undocumented and inconsistent in [live] data → not surfaced.

  return {
    id: t.id != null ? String(t.id) : null,
    marketId: t.marketId || null,
    wallet: t.wallet || null,
    signature: t.signature || null,
    blockTime: typeof t.blockTime === "number" ? t.blockTime : null,
    isPrimary: typeof t.isPrimary === "boolean" ? t.isPrimary : null,
    kind: t.kind ? t.kind.toLowerCase() : null,
    side,
    shares: shares != null && shares > 0 ? shares : null,
    amountUsdc: amountUsdc != null && amountUsdc > 0 ? amountUsdc : null,
  };
}

// ---------------------------------------------------------------------------
// Attribution rows (GET /account/trades/)
// ---------------------------------------------------------------------------

export function normalizeAccountTrade(t: RawAccountTrade): AccountTrade {
  return {
    signature: t.signature,
    wallet: t.wallet || null,
    marketId: t.marketId || null,
    side: parseSide(t.side),
    kind: t.kind ? t.kind.toLowerCase() : null,
    status: t.status || null,
    createdAt: t.createdAt || null,
    // [docs-acct] "amountUsdc (human decimal), amountUsdcBase" (base units).
    amountUsdc: humanAmount(t.amountUsdc) ?? fromBaseUnits(t.amountUsdcBase),
  };
}

// Positions: [docs-positions] `shares` is a "Human-readable share quantity"
// (see positions.ts). Primary quotes: [docs-orders] "Amounts are
// human-readable decimal USDC strings (for example "20.00"), not base units"
// (see orders.ts).

// NOTE: POST /primaryorderverify/ documents `amountUsdc: 20000000` (an integer
// in base units despite the plain name). We never display that field; only
// `status` is consumed from verify.

// ---------------------------------------------------------------------------
// Market volume
// ---------------------------------------------------------------------------

/** Human USDC volume: prefer human fields, else ÷1e6 of `*Base`. */
export function marketVolumeUsdc(
  m: Pick<
    Market,
    "volumeUsdc" | "totalVolumeUsdc" | "volumeUsdcBase" | "totalVolumeUsdcBase"
  >,
): number | null {
  // [docs-list] `volumeUsdc`: "Human-readable volume". [live] volumeUsdcBase
  // "3725490199" pairs with volumeUsdc "3725.490199" → base units.
  const human = humanAmount(m.volumeUsdc) ?? humanAmount(m.totalVolumeUsdc);
  if (human != null && human > 0) return human;
  const base = fromBaseUnits(m.volumeUsdcBase) ?? fromBaseUnits(m.totalVolumeUsdcBase);
  if (base != null && base > 0) return base;
  return null;
}
