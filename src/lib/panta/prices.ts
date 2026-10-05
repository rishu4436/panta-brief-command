/**
 * The one place that turns Panta's YES/NO price fields into implied
 * probabilities. Every consumer (desk, market detail, landing showcase,
 * sidebar, Book marks, signals/brief) goes through `marketProbability`.
 *
 * What the fields mean (checked against live detail responses, 3 Oct 2026):
 *  - `yesPrice` / `noPrice`: Panta's per-side display price. For a primary
 *    market each equals the bonding-curve price (= primary*). For a secondary
 *    market (`priceSource: "secondary_last_trade"`) EACH SIDE is filled on its
 *    own: the side's last secondary trade price (secondary*Price / 1e9) when
 *    that side has traded, else that side's primary price. They are therefore
 *    NOT guaranteed to be complementary. Live examples:
 *      Dangote 3Ry1mLYL…: secondaryYes=secondaryNo=1e9 → yesPrice 1, noPrice 1
 *      HYPE   Dhtmh7zc…: secondaryYes=5e8, secondaryNo=0 → yesPrice 0.5,
 *                        noPrice 0.328 (= primaryNoPrice)
 *  - `primaryYesPrice` / `primaryNoPrice`: bonding-curve price, lastYesPrice
 *    / 1e9 and its complement (sum to 1 by construction). After graduation the
 *    curve stops moving, so for a secondary market this is the price at
 *    graduation, not a current price — never used as a probability there.
 *  - `secondaryYesPrice` / `secondaryNoPrice`: raw 1e9-scaled per-side last
 *    trade prices; never a probability.
 *
 * Rule: YES/NO are shown as probabilities only when both are present, finite,
 * inside [0, 1] and sum to 1 within PRICE_SUM_TOLERANCE. Otherwise the
 * probability is unavailable with a reason, and the raw fields are kept for
 * debugging/evidence. The primary curve is used only for a market that is
 * still in the primary phase (where it IS the live price) and only when it
 * passes the same check.
 */

export const PRICE_SUM_TOLERANCE = 0.02;

/** Panta `secondary*Price` is 1e9-scaled (same scale as on-chain lastYesPrice). */
export const SECONDARY_PRICE_SCALE = 1e9;

export function isSecondaryPhase(m: PriceFields): boolean {
  const p = (m.phase || "").toLowerCase();
  const s = (m.status || "").toLowerCase();
  return p === "secondary" || (!p && (s === "secondary" || s === "secondary_active"));
}

/**
 * Decode one secondary last-trade field to USDC per share.
 * - null/empty → no observation
 * - 0 → no observation (Panta fills the other side's yesPrice from primary when
 *   secondary*Price is 0 — see file header HYPE example)
 * - value > 1 → divide by SECONDARY_PRICE_SCALE
 * - value in (0, 1] → already human USDC/share
 */
export function decodeSecondaryPriceField(raw: string | number | null | undefined): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n === 0) return null;
  if (n > 1) return n / SECONDARY_PRICE_SCALE;
  return n;
}

export type SecondaryLastObserved = {
  yes: number | null;
  no: number | null;
  /** Combined label for tooling; UI should prefer yesLabel/noLabel. */
  label: "Last observed secondary prices";
  yesLabel: "Last observed YES secondary price";
  noLabel: "Last observed NO secondary price";
  observedAtLabel: "time not provided";
  yesRaw: string | null;
  noRaw: string | null;
};

/**
 * Independent per-side last observed secondary prices (USDC per share).
 * Never complements sides, never uses primary* curve fields.
 */
export function secondaryLastObservedPrices(m: PriceFields): SecondaryLastObserved {
  const yesFromSec = decodeSecondaryPriceField(m.secondaryYesPrice);
  const noFromSec = decodeSecondaryPriceField(m.secondaryNoPrice);
  const yesAbsent = m.secondaryYesPrice === undefined || m.secondaryYesPrice === null || m.secondaryYesPrice === "";
  const noAbsent = m.secondaryNoPrice === undefined || m.secondaryNoPrice === null || m.secondaryNoPrice === "";
  // Fall back to yesPrice/noPrice only when secondary* is absent (not when 0).
  const yes =
    yesFromSec ??
    (isSecondaryPhase(m) && yesAbsent ? decodeSecondaryPriceField(m.yesPrice) : null);
  const no =
    noFromSec ??
    (isSecondaryPhase(m) && noAbsent ? decodeSecondaryPriceField(m.noPrice) : null);
  return {
    yes,
    no,
    label: "Last observed secondary prices",
    yesLabel: "Last observed YES secondary price",
    noLabel: "Last observed NO secondary price",
    observedAtLabel: "time not provided",
    yesRaw: m.secondaryYesPrice != null && m.secondaryYesPrice !== "" ? String(m.secondaryYesPrice) : null,
    noRaw: m.secondaryNoPrice != null && m.secondaryNoPrice !== "" ? String(m.secondaryNoPrice) : null,
  };
}


export type ProbabilitySource = "spot" | "settled" | "primary_curve" | "unavailable";
export type ProbabilityUnavailableReason =
  | "missing_prices"
  | "incomplete_prices"
  | "inconsistent_prices"
  | "not_applicable";

export type PriceFields = {
  phase?: string | null;
  status?: string | null;
  resolved?: boolean | null;
  yesPrice?: string | number | null;
  noPrice?: string | number | null;
  primaryYesPrice?: string | number | null;
  primaryNoPrice?: string | number | null;
  secondaryYesPrice?: string | number | null;
  secondaryNoPrice?: string | number | null;
};

export type MarketProbability = {
  yes: number | null;
  no: number | null;
  source: ProbabilitySource;
  reason: ProbabilityUnavailableReason | null;
  /** Raw Panta fields, unmodified (debugging / evidence). */
  raw: {
    yesPrice: string | null;
    noPrice: string | null;
    primaryYesPrice: string | null;
    primaryNoPrice: string | null;
    secondaryYesPrice: string | null;
    secondaryNoPrice: string | null;
  };
};

const rawStr = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

type PairCheck =
  | { ok: true; yes: number; no: number }
  | { ok: false; reason: ProbabilityUnavailableReason };

/** Validate one YES/NO pair as complementary probabilities. */
export function checkPricePair(yesRaw: unknown, noRaw: unknown): PairCheck {
  const y = num(yesRaw);
  const n = num(noRaw);
  if (y === null && n === null) return { ok: false, reason: "missing_prices" };
  if ((y !== null && !(y >= 0 && y <= 1)) || (n !== null && !(n >= 0 && n <= 1))) {
    return { ok: false, reason: "inconsistent_prices" };
  }
  // One side only: complementarity can't be checked, so don't assume it.
  if (y === null || n === null) return { ok: false, reason: "incomplete_prices" };
  if (Math.abs(y + n - 1) > PRICE_SUM_TOLERANCE) return { ok: false, reason: "inconsistent_prices" };
  return { ok: true, yes: y, no: n };
}

const isResolved = (m: PriceFields) =>
  Boolean(m.resolved) || (m.phase || "").toLowerCase() === "resolved" || (m.status || "").toLowerCase() === "resolved";

const isPrimaryPhase = (m: PriceFields) => {
  const p = (m.phase || "").toLowerCase();
  const s = (m.status || "").toLowerCase();
  return p === "primary" || (!p && (s === "primary" || s === "open"));
};

export function marketProbability(m: PriceFields): MarketProbability {
  const raw = {
    yesPrice: rawStr(m.yesPrice),
    noPrice: rawStr(m.noPrice),
    primaryYesPrice: rawStr(m.primaryYesPrice),
    primaryNoPrice: rawStr(m.primaryNoPrice),
    secondaryYesPrice: rawStr(m.secondaryYesPrice),
    secondaryNoPrice: rawStr(m.secondaryNoPrice),
  };
  const resolved = isResolved(m);
  const spot = checkPricePair(m.yesPrice, m.noPrice);
  // Secondary YES/NO are independent last-trade observations (P2P CLOB), never
  // complementary probabilities — even when they happen to sum to ~1.
  // Probability is not applicable (expected for secondary), not a data defect.
  if (!resolved && isSecondaryPhase(m)) {
    return { yes: null, no: null, source: "unavailable", reason: "not_applicable", raw };
  }
  if (spot.ok) return { yes: spot.yes, no: spot.no, source: resolved ? "settled" : "spot", reason: null, raw };
  // Primary curve = the live price only while the market is in the primary phase.
  if (spot.reason === "missing_prices" && !resolved && isPrimaryPhase(m)) {
    const curve = checkPricePair(m.primaryYesPrice, m.primaryNoPrice);
    if (curve.ok) return { yes: curve.yes, no: curve.no, source: "primary_curve", reason: null, raw };
    return { yes: null, no: null, source: "unavailable", reason: curve.reason, raw };
  }
  return { yes: null, no: null, source: "unavailable", reason: spot.reason, raw };
}

export const PROBABILITY_UNAVAILABLE_TEXT: Record<ProbabilityUnavailableReason, { short: string; long: string }> = {
  missing_prices: { short: "No price yet", long: "Panta returned no YES/NO price for this market." },
  incomplete_prices: {
    short: "Probability unavailable",
    long: "Panta returned a price for only one side, so the implied probability can't be checked.",
  },
  inconsistent_prices: {
    short: "Probability unavailable",
    long: "Panta's YES and NO prices don't add up to 100%, so they can't be read as probabilities.",
  },
  not_applicable: {
    short: "Probability not applicable",
    long: "Independent per-side last observations — probability not applicable (secondary P2P CLOB).",
  },
};

/** "YES 1 · NO 1" style raw readout for tooltips/evidence (no conversion). */
export function rawPriceNote(p: MarketProbability): string {
  return `Raw Panta prices: yesPrice ${p.raw.yesPrice ?? "null"}, noPrice ${p.raw.noPrice ?? "null"}`;
}

export type PositionMark =
  | { value: number; price: number; reason: null }
  | { value: null; price: null; reason: ProbabilityUnavailableReason | "unknown_side" | "unknown_shares" };

/**
 * Mark-to-market for a position = shares × validated side probability.
 * Never computed from missing, one-sided or inconsistent prices.
 */
export function positionMark(
  shares: number | null | undefined,
  side: string | null | undefined,
  p: MarketProbability,
): PositionMark {
  if (p.yes == null || p.no == null) return { value: null, price: null, reason: p.reason ?? "missing_prices" };
  if (side !== "yes" && side !== "no") return { value: null, price: null, reason: "unknown_side" };
  if (shares == null || !Number.isFinite(shares)) return { value: null, price: null, reason: "unknown_shares" };
  const price = side === "yes" ? p.yes : p.no;
  return { value: shares * price, price, reason: null };
}
