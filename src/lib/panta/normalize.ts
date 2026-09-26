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

import type {
  AccountTradeItem,
  CatalogTradeRow,
  MarketCatalogItem,
  PositionRow,
  PrimaryQuoteResponse,
} from "@/lib/types";

export const PANTA_DECIMALS = 6;
const BASE = 10 ** PANTA_DECIMALS;

type Numish = string | number | null | undefined;

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

export type PantaSide = "yes" | "no";

function parseSide(v: unknown): PantaSide | null {
  const s = String(v ?? "").toLowerCase();
  if (s === "yes" || s === "y") return "yes";
  if (s === "no" || s === "n") return "no";
  return null;
}

// ---------------------------------------------------------------------------
// Trades (catalog tape: GET /markets/{id}/trades/)
// ---------------------------------------------------------------------------

export type NormalizedTrade = {
  id: string | null;
  marketId: string | null;
  wallet: string | null;
  signature: string | null;
  blockTime: number | null;
  isPrimary: boolean | null;
  kind: string | null;
  side: PantaSide | null;
  /** Shares received, human units. null when the row carries no share size. */
  shares: number | null;
  /** USDC paid, human units. null when the row carries no USDC size. */
  amountUsdc: number | null;
};

/** Extra fields the live API returns on tape rows (not in docs table). */
type TradeRowLive = CatalogTradeRow & {
  shares?: string | number | null;
  sharesBase?: string | number | null;
};

export function normalizePantaTrade(raw: CatalogTradeRow): NormalizedTrade {
  const t = raw as TradeRowLive;

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
    marketId: t.marketId ?? null,
    wallet: t.wallet ?? null,
    signature: t.signature ?? null,
    blockTime: typeof t.blockTime === "number" ? t.blockTime : null,
    isPrimary: typeof t.isPrimary === "boolean" ? t.isPrimary : null,
    kind: t.kind ?? null,
    side,
    shares: shares != null && shares > 0 ? shares : null,
    amountUsdc: amountUsdc != null && amountUsdc > 0 ? amountUsdc : null,
  };
}

// ---------------------------------------------------------------------------
// Attribution rows (GET /account/trades/)
// ---------------------------------------------------------------------------

export type NormalizedAccountTrade = {
  signature: string;
  marketId: string | null;
  side: PantaSide | null;
  kind: string | null;
  status: string | null;
  amountUsdc: number | null;
};

export function normalizeAccountTrade(t: AccountTradeItem): NormalizedAccountTrade {
  return {
    signature: t.signature,
    marketId: t.marketId ?? null,
    side: parseSide(t.side),
    kind: t.kind ?? null,
    status: t.status ?? null,
    // [docs-acct] "amountUsdc (human decimal), amountUsdcBase" (base units).
    amountUsdc: humanAmount(t.amountUsdc) ?? fromBaseUnits(t.amountUsdcBase),
  };
}

// ---------------------------------------------------------------------------
// Positions (GET /positions/)
// ---------------------------------------------------------------------------

export type NormalizedPosition = PositionRow & { sharesNum: number | null };

export function normalizePantaPosition(p: PositionRow): NormalizedPosition {
  // [docs-positions] `shares`: "Human-readable share quantity".
  return { ...p, sharesNum: humanAmount(p.shares) };
}

// ---------------------------------------------------------------------------
// Primary quote (POST /primaryorderquote/)
// ---------------------------------------------------------------------------

export type NormalizedQuote = {
  quoteId: string;
  side: PantaSide | null;
  amountUsdc: number | null;
  shares: number | null;
  avgPrice: number | null;
  feeUsdc: number | null;
  expiresAt: string | null;
};

export function normalizePantaQuote(q: PrimaryQuoteResponse): NormalizedQuote {
  // [docs-orders] "Amounts are human-readable decimal USDC strings (for example
  // "20.00"), not base units" — amountUsdc, feeUsdc, shares, avgPrice as-is.
  return {
    quoteId: q.quoteId,
    side: parseSide(q.side),
    amountUsdc: humanAmount(q.amountUsdc),
    shares: humanAmount(q.shares),
    avgPrice: humanAmount(q.avgPrice),
    feeUsdc: humanAmount(q.feeUsdc),
    expiresAt: q.expiresAt ?? null,
  };
}

// NOTE: POST /primaryorderverify/ documents `amountUsdc: 20000000` (an integer
// in base units despite the plain name). We never display that field; only
// `status` is consumed from verify.

// ---------------------------------------------------------------------------
// Market volume
// ---------------------------------------------------------------------------

/** Human USDC volume: prefer human fields, else ÷1e6 of `*Base`. */
export function marketVolumeUsdc(
  m: Pick<
    MarketCatalogItem,
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
