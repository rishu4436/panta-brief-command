/**
 * Deterministic Market Signal Layer.
 *
 * Pure function of (market detail, tape rows, now) → structured evidence.
 * No network, no randomness, no model. Anything that cannot be computed from
 * the data is `null` with a reason — values are never invented. The LLM (or
 * the template) only interprets this object; it must not recompute it.
 *
 * Unit contracts come from ./normalize (shares are human units; no magnitude
 * guessing). Tape rows carry side + shares but no per-trade price, so a
 * probability change across the window is not derivable today.
 */

import type { Market, Trade } from "./domain";
import { marketVolumeUsdc } from "./normalize";
import { marketProbability, type MarketProbability, type ProbabilitySource, type ProbabilityUnavailableReason } from "./prices";

export const SIGNALS_VERSION = 2;

/** Thresholds (documented so the brief can cite them). */
export const SIGNAL_THRESHOLDS = {
  thinTapePrints: 5,
  solidTapePrints: 10,
  staleLastPrintHours: 72,
  freshLastPrintHours: 24,
  resolutionSoonMinutes: 24 * 60,
  balancedImbalance: 0.15,
  strongImbalance: 0.4,
  oneSidedImbalance: 0.8,
  alignedGapPts: 10,
  divergentGapPts: 20,
  /** Top wallet's share of prints (print concentration) that raises a flag. */
  concentratedPrintShare: 0.5,
  /** Top wallet's share of traded size (shares / USDC) that raises a flag. */
  concentratedSizeShare: 0.5,
} as const;

export type DataQualityGrade = "high" | "medium" | "low";
export type { ProbabilitySource } from "./prices";
export type RiskSeverity = "warn" | "info";

export type RiskFlag = { id: string; label: string; severity: RiskSeverity };

export type MarketSignals = {
  version: typeof SIGNALS_VERSION;
  computedAt: string;
  phase: string | null;
  resolved: boolean;
  outcome: "yes" | "no" | null;
  probability: {
    yes: number | null;
    no: number | null;
    source: ProbabilitySource;
    /** Why there is no probability (null when there is one). */
    reason: ProbabilityUnavailableReason | null;
    /** Raw Panta price fields as received (evidence; never used as odds). */
    raw: MarketProbability["raw"];
  };
  probabilityChange: {
    value: number | null;
    reason: string;
  };
  tape: {
    count: number;
    yesPrints: number;
    noPrints: number;
    unknownSidePrints: number;
    /** YES prints ÷ (YES + NO prints). */
    yesPrintRatio: number | null;
    primaryPrints: number;
    secondaryPrints: number;
    windowStart: number | null;
    windowEnd: number | null;
    windowMinutes: number | null;
    lastPrintAgeMinutes: number | null;
    /**
     * Print concentration: the most active wallet's share of the PRINT COUNT
     * (0–1). Counts trades, not size — one wallet making many small trades
     * scores high here.
     */
    printConcentration: {
      topWalletShareOfPrints: number | null;
      /** Distinct wallets on prints that carry a wallet. */
      wallets: number;
      /** Prints with no wallet (excluded from the share). */
      printsWithoutWallet: number;
    };
    /**
     * Size concentration: the largest wallet's share of TRADED SIZE (0–1).
     * Computed only when every wallet-attributed print carries a size —
     * shares when all have shares, else USDC when all have USDC — so it is
     * never mixed with or guessed from print counts. null + reason otherwise.
     */
    sizeConcentration: {
      topWalletShareOfSize: number | null;
      basis: "shares" | "usdc" | null;
      reason: string | null;
    };
  };
  flow: {
    yesShares: number | null;
    noShares: number | null;
    /** YES share of flow (0–1), share-weighted when sizes exist, else print-weighted. */
    yesFlowShare: number | null;
    /** (YES − NO) ÷ (YES + NO), −1…+1. */
    imbalance: number | null;
    basis: "shares" | "prints" | null;
  };
  volume: {
    /** Lifetime catalog volume (USDC). */
    catalogUsdc: number | null;
    /** Sum of USDC on tape rows in the window; null unless every print carries USDC. */
    recentUsdc: number | null;
    /** Sum of shares in the window; null unless EVERY print carries shares. */
    recentShares: number | null;
    /** complete = every print sized; partial = some prints lack shares; none = no sized prints / no prints. */
    sharesStatus: "complete" | "partial" | "none";
    /** Sum over the prints that do carry shares (a lower bound when partial). */
    knownShares: number | null;
    /** Prints in the window without a share size. */
    printsWithoutShares: number;
    note: string | null;
  };
  resolution: {
    resolutionTime: number | null;
    minutesToResolution: number | null;
    passed: boolean | null;
  };
  divergence: {
    marketYes: number | null;
    flowYes: number | null;
    /** (flowYes − marketYes) in percentage points. */
    gapPts: number | null;
    direction: "flow_above_price" | "flow_below_price" | "aligned" | null;
    reason: string | null;
  };
  dataQuality: { grade: DataQualityGrade; reasons: string[] };
  riskFlags: RiskFlag[];
  execution: { primaryOpen: boolean; lines: string[] };
  /** One deterministic sentence describing the flow signal. */
  headline: string;
};

const round = (n: number, dp = 4) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

function pct(n: number, dp = 0): string {
  return `${(n * 100).toFixed(dp)}%`;
}

function ageLabel(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function resolveProbability(m: Market, resolved: boolean) {
  // Single validation layer (prices.ts): inconsistent / one-sided / missing
  // prices become source "unavailable" with a reason — never odds.
  const p = marketProbability({ ...m, resolved: m.resolved || resolved });
  return {
    yes: p.yes == null ? null : round(p.yes),
    no: p.no == null ? null : round(p.no),
    source: p.source,
    reason: p.reason,
    raw: p.raw,
  };
}

/** Catalog text usable for catalysts: description, else the resolution rule. */
export function catalogText(m: Market): { kind: "description" | "resolution rule"; text: string } | null {
  const d = (m.description || "").trim();
  if (d) return { kind: "description", text: d };
  const r = (m.resolutionRule || "").trim();
  if (r) return { kind: "resolution rule", text: r };
  return null;
}

export function computeMarketSignals(
  market: Market,
  tape: Trade[],
  nowMs: number = Date.now(),
  opts: { partialDetail?: boolean } = {},
): MarketSignals {
  const T = SIGNAL_THRESHOLDS;
  const nowSec = nowMs / 1000;
  const phase = (market.phase || "").toLowerCase() || null;
  const resolved = Boolean(market.resolved) || phase === "resolved";
  const cancelled = phase === "cancelled" || phase === "canceled";

  // --- Probability
  const probability = resolveProbability(market, resolved);
  const outcome: "yes" | "no" | null =
    resolved && probability.yes === 1 ? "yes" : resolved && probability.yes === 0 ? "no" : null;

  // --- Tape
  const count = tape.length;
  let yesPrints = 0;
  let noPrints = 0;
  let primaryPrints = 0;
  let secondaryPrints = 0;
  let yesShares = 0;
  let noShares = 0;
  let sidedWithShares = 0;
  let usdcSum = 0;
  let usdcRows = 0;
  let sharesSum = 0;
  let sharesRows = 0;
  const walletCounts = new Map<string, number>();
  const walletShares = new Map<string, number>();
  const walletUsdc = new Map<string, number>();
  let walletPrints = 0;
  let walletPrintsWithShares = 0;
  let walletPrintsWithUsdc = 0;
  const times: number[] = [];

  for (const t of tape) {
    if (t.side === "yes") yesPrints += 1;
    else if (t.side === "no") noPrints += 1;
    if (t.isPrimary === true) primaryPrints += 1;
    else if (t.isPrimary === false) secondaryPrints += 1;
    if (t.side && t.shares != null) {
      sidedWithShares += 1;
      if (t.side === "yes") yesShares += t.shares;
      else noShares += t.shares;
    }
    if (t.shares != null && Number.isFinite(t.shares)) {
      sharesSum += t.shares;
      sharesRows += 1;
    }
    if (t.amountUsdc != null) {
      usdcSum += t.amountUsdc;
      usdcRows += 1;
    }
    if (t.wallet) {
      walletPrints += 1;
      walletCounts.set(t.wallet, (walletCounts.get(t.wallet) || 0) + 1);
      if (t.shares != null && Number.isFinite(t.shares) && t.shares >= 0) {
        walletPrintsWithShares += 1;
        walletShares.set(t.wallet, (walletShares.get(t.wallet) || 0) + t.shares);
      }
      if (t.amountUsdc != null && Number.isFinite(t.amountUsdc) && t.amountUsdc >= 0) {
        walletPrintsWithUsdc += 1;
        walletUsdc.set(t.wallet, (walletUsdc.get(t.wallet) || 0) + t.amountUsdc);
      }
    }
    if (t.blockTime != null) times.push(t.blockTime);
  }
  const sided = yesPrints + noPrints;
  const windowStart = times.length ? Math.min(...times) : null;
  const windowEnd = times.length ? Math.max(...times) : null;
  const topWalletPrints = walletCounts.size ? Math.max(...walletCounts.values()) : 0;

  const topOf = (m: Map<string, number>) => {
    const vals = [...m.values()];
    const total = vals.reduce((a, b) => a + b, 0);
    return total > 0 ? round(Math.max(...vals) / total) : null;
  };
  let sizeConcentration: MarketSignals["tape"]["sizeConcentration"];
  if (walletPrints === 0) {
    sizeConcentration = {
      topWalletShareOfSize: null,
      basis: null,
      reason: count === 0 ? "No prints in the tape window" : "Prints carry no wallet",
    };
  } else if (walletPrintsWithShares === walletPrints && topOf(walletShares) != null) {
    sizeConcentration = { topWalletShareOfSize: topOf(walletShares), basis: "shares", reason: null };
  } else if (walletPrintsWithUsdc === walletPrints && topOf(walletUsdc) != null) {
    sizeConcentration = { topWalletShareOfSize: topOf(walletUsdc), basis: "usdc", reason: null };
  } else {
    sizeConcentration = {
      topWalletShareOfSize: null,
      basis: null,
      reason: "Not every print carries a trade size, so the size share is unknown",
    };
  }

  const tapeBlock: MarketSignals["tape"] = {
    count,
    yesPrints,
    noPrints,
    unknownSidePrints: count - sided,
    yesPrintRatio: sided ? round(yesPrints / sided) : null,
    primaryPrints,
    secondaryPrints,
    windowStart,
    windowEnd,
    windowMinutes:
      windowStart != null && windowEnd != null ? Math.round((windowEnd - windowStart) / 60) : null,
    lastPrintAgeMinutes: windowEnd != null ? Math.max(0, Math.round((nowSec - windowEnd) / 60)) : null,
    printConcentration: {
      topWalletShareOfPrints: walletPrints ? round(topWalletPrints / walletPrints) : null,
      wallets: walletCounts.size,
      printsWithoutWallet: count - walletPrints,
    },
    sizeConcentration,
  };

  // --- Flow (share-weighted only when every sided print has a size)
  let flow: MarketSignals["flow"];
  if (sided > 0 && sidedWithShares === sided && yesShares + noShares > 0) {
    const total = yesShares + noShares;
    flow = {
      yesShares: round(yesShares, 6),
      noShares: round(noShares, 6),
      yesFlowShare: round(yesShares / total),
      imbalance: round((yesShares - noShares) / total),
      basis: "shares",
    };
  } else if (sided > 0) {
    flow = {
      yesShares: null,
      noShares: null,
      yesFlowShare: round(yesPrints / sided),
      imbalance: round((yesPrints - noPrints) / sided),
      basis: "prints",
    };
  } else {
    flow = { yesShares: null, noShares: null, yesFlowShare: null, imbalance: null, basis: null };
  }

  // --- Volume
  const volume: MarketSignals["volume"] = {
    catalogUsdc: marketVolumeUsdc(market),
    recentUsdc: count > 0 && usdcRows === count ? round(usdcSum, 2) : null,
    recentShares: count > 0 && sharesRows === count ? round(sharesSum, 2) : null,
    sharesStatus: count > 0 && sharesRows === count ? "complete" : sharesRows > 0 ? "partial" : "none",
    knownShares: sharesRows > 0 ? round(sharesSum, 2) : null,
    printsWithoutShares: count - sharesRows,
    note:
      count === 0
        ? "No prints in the tape window."
        : sharesRows > 0 && sharesRows < count
          ? `${count - sharesRows} of ${count} prints lack a share size, so the window's share volume is incomplete (known: ${round(sharesSum, 2)} shares across ${sharesRows} prints).`
          : usdcRows === count
            ? null
            : sharesRows === 0
              ? "Tape rows carry neither share sizes nor USDC paid; recent volume is unknown."
              : "Tape rows carry share sizes but not USDC paid; recent volume is reported in shares.",
  };

  // --- Probability change: tape rows have no per-trade price → not derivable.
  const probabilityChange: MarketSignals["probabilityChange"] = {
    value: null,
    reason:
      count === 0
        ? "No prints in the window."
        : "Tape rows carry side and size but no per-trade price, so a change across the window cannot be derived honestly.",
  };

  // --- Resolution
  const resolutionTime = market.resolutionTime ?? market.endTime ?? null;
  const resolution: MarketSignals["resolution"] =
    resolutionTime != null
      ? {
          resolutionTime,
          minutesToResolution:
            resolutionTime > nowSec ? Math.round((resolutionTime - nowSec) / 60) : null,
          passed: resolutionTime <= nowSec,
        }
      : { resolutionTime: null, minutesToResolution: null, passed: null };

  // --- Divergence (market probability vs recent-flow share)
  let divergence: MarketSignals["divergence"];
  if (resolved) {
    divergence = {
      marketYes: probability.yes,
      flowYes: flow.yesFlowShare,
      gapPts: null,
      direction: null,
      reason: "Market is resolved; price is the settlement, so divergence is not meaningful.",
    };
  } else if (probability.yes == null || flow.yesFlowShare == null) {
    divergence = {
      marketYes: probability.yes,
      flowYes: flow.yesFlowShare,
      gapPts: null,
      direction: null,
      reason:
        probability.yes == null
          ? probability.reason === "inconsistent_prices"
            ? "Panta's YES/NO prices are inconsistent, so there is no probability to compare."
            : "No market price."
          : "No sided prints in the window.",
    };
  } else if (sided < 3) {
    divergence = {
      marketYes: probability.yes,
      flowYes: flow.yesFlowShare,
      gapPts: null,
      direction: null,
      reason: `Only ${sided} sided print(s); too few to compare flow with price.`,
    };
  } else {
    const gap = round((flow.yesFlowShare - probability.yes) * 100, 1);
    divergence = {
      marketYes: probability.yes,
      flowYes: flow.yesFlowShare,
      gapPts: gap,
      direction:
        Math.abs(gap) < T.alignedGapPts ? "aligned" : gap > 0 ? "flow_above_price" : "flow_below_price",
      reason: null,
    };
  }

  // --- Risk flags
  const riskFlags: RiskFlag[] = [];
  const add = (id: string, label: string, severity: RiskSeverity = "warn") =>
    riskFlags.push({ id, label, severity });

  if (resolved) {
    add(
      "resolved",
      `Resolved${outcome ? ` ${outcome.toUpperCase()}` : ""} — prices are settlement values, tape is pre-resolution`,
      "info",
    );
  }
  if (cancelled) add("cancelled", "Market cancelled — no trading");
  const partialDetail = opts.partialDetail ?? market.partial === true;
  if (partialDetail) add("partial_detail", "Panta returned a partial market record (no title or price)");
  if (probability.reason === "inconsistent_prices") {
    add("inconsistent_prices", "Panta's YES/NO prices are inconsistent — implied probability unavailable");
  } else if (probability.reason === "incomplete_prices") {
    add("incomplete_prices", "Panta priced only one side — implied probability unavailable");
  } else if (probability.yes == null) add("no_price", "No live price — odds unavailable");
  if (count === 0) add("no_tape", "No recent prints in the tape window");
  else if (count < T.thinTapePrints) add("thin_tape", `Thin tape — ${count} print${count === 1 ? "" : "s"}`);
  if (
    resolution.minutesToResolution != null &&
    resolution.minutesToResolution < T.resolutionSoonMinutes &&
    !resolved
  ) {
    add("resolution_soon", `Resolution in under 24h (${ageLabel(resolution.minutesToResolution)})`);
  }
  if (resolution.passed && !resolved && !cancelled) {
    add("resolution_passed", "Resolution time has passed — awaiting settlement");
  }
  if (
    !resolved &&
    tapeBlock.lastPrintAgeMinutes != null &&
    tapeBlock.lastPrintAgeMinutes > T.staleLastPrintHours * 60
  ) {
    add("stale_last_print", `Last print ${ageLabel(tapeBlock.lastPrintAgeMinutes)} ago`);
  }
  if (phase === "primary") {
    add("primary_quote_vs_spot", "Primary quote (bonding-curve avgPrice) may differ from spot", "info");
  }
  if (
    !resolved &&
    flow.imbalance != null &&
    flow.yesFlowShare != null &&
    sided >= T.thinTapePrints &&
    Math.abs(flow.imbalance) >= T.oneSidedImbalance
  ) {
    const lead = flow.imbalance > 0 ? "YES" : "NO";
    const leadShare = flow.imbalance > 0 ? flow.yesFlowShare! : 1 - flow.yesFlowShare!;
    add("one_sided_flow", `One-sided flow — ${lead} is ${pct(leadShare)} of ${flow.basis}`);
  }
  const printTop = tapeBlock.printConcentration.topWalletShareOfPrints;
  if (count >= T.thinTapePrints && printTop != null && printTop >= T.concentratedPrintShare) {
    add("concentrated_prints", `Print concentration — top wallet made ${pct(printTop, 1)} of observed prints`);
  }
  const sizeTop = tapeBlock.sizeConcentration;
  if (count >= T.thinTapePrints && sizeTop.topWalletShareOfSize != null && sizeTop.topWalletShareOfSize >= T.concentratedSizeShare) {
    add(
      "concentrated_size",
      `Size concentration — top wallet accounts for ${pct(sizeTop.topWalletShareOfSize, 1)} of observed traded ${sizeTop.basis === "usdc" ? "USDC" : "shares"}`,
    );
  }
  if (divergence.gapPts != null && Math.abs(divergence.gapPts) >= T.divergentGapPts) {
    add(
      "flow_price_divergence",
      `Flow and price diverge by ${Math.abs(divergence.gapPts).toFixed(0)} pts`,
    );
  }
  if (!catalogText(market)) {
    add("no_description", "No description or resolution rule in the catalog", "info");
  }

  // --- Data quality (start high, apply caps; each cap records a reason)
  const reasons: string[] = [];
  let level = 3;
  const cap = (max: number, reason: string) => {
    level = Math.min(level, max);
    reasons.push(reason);
  };
  if (partialDetail) cap(1, "Partial market record from Panta");
  if (probability.reason === "inconsistent_prices") cap(1, "Panta's YES/NO prices are inconsistent (not probabilities)");
  else if (probability.reason === "incomplete_prices") cap(1, "Only one side priced");
  else if (probability.yes == null) cap(1, "No market price");
  if (count === 0) cap(1, "No prints in the tape window");
  else if (count < T.thinTapePrints) cap(1, `Only ${count} print(s)`);
  else if (count < T.solidTapePrints) cap(2, `${count} prints (< ${T.solidTapePrints})`);
  if (flow.basis === "prints") cap(2, "Flow is print-weighted (no share sizes)");
  if (tapeBlock.lastPrintAgeMinutes != null && !resolved) {
    if (tapeBlock.lastPrintAgeMinutes > T.staleLastPrintHours * 60) cap(1, "Last print is stale");
    else if (tapeBlock.lastPrintAgeMinutes > T.freshLastPrintHours * 60) cap(2, "Last print older than 24h");
  }
  if (!(market.title || "").trim()) cap(2, "Untitled market");
  if (probability.source === "primary_curve") cap(2, "Price from primary curve, not live spot");
  if (level === 3) {
    reasons.push(
      resolved
        ? `${count} prints, share-weighted, settled price (tape is pre-resolution)`
        : `${count} prints, share-weighted, live price, fresh tape`,
    );
  }
  const grade: DataQualityGrade = level >= 3 ? "high" : level === 2 ? "medium" : "low";

  // --- Execution (factual, no recommendations)
  const lines: string[] = [];
  const primaryOpen = phase === "primary" && !resolved && !cancelled;
  if (primaryOpen) {
    lines.push("Primary YES and NO available · quote required before sizing");
    lines.push("Fill price comes from the bonding-curve quote (avgPrice), not the spot label");
    lines.push("Each quote carries Panta's own expiry (expiresAt); the ticket counts down to it and won't build or sign after it");
  } else if (resolved) {
    lines.push("Resolved · no new buys");
    lines.push("Holders of the winning side can build a win claim in Book");
  } else if (cancelled) {
    lines.push("Cancelled · no trading on this market");
  } else if (phase === "secondary") {
    lines.push("Secondary phase · primary buys closed");
    lines.push("This desk routes primary buys only; secondary AMM routing is out of scope");
  } else {
    lines.push("Phase unknown · check market detail before quoting");
  }

  // --- Headline (observational)
  let headline: string;
  const n = count;
  const basisWord = flow.basis === "shares" ? "of shares" : "of prints";
  if (n === 0 || flow.yesFlowShare == null || flow.imbalance == null) {
    headline = n === 0
      ? "No recent prints — flow signal unavailable."
      : `${n} recent print(s) without a readable side — flow signal unavailable.`;
  } else {
    const yesShare = pct(flow.yesFlowShare);
    const noShare = pct(1 - flow.yesFlowShare);
    const prefix = resolved ? "Pre-resolution tape: " : "";
    if (Math.abs(flow.imbalance) < T.balancedImbalance) {
      headline = `${prefix}Flow is balanced across the last ${n} prints (YES ${yesShare} · NO ${noShare} ${basisWord}).`;
    } else {
      const lead = flow.imbalance > 0 ? "YES" : "NO";
      const lag = flow.imbalance > 0 ? "NO" : "YES";
      const strength = Math.abs(flow.imbalance) >= T.strongImbalance ? "materially outweighs" : "outweighs";
      const leadShare = flow.imbalance > 0 ? yesShare : noShare;
      headline = `${prefix}${lead} flow ${strength} ${lag} over the last ${n} prints (${leadShare} ${basisWord}).`;
    }
  }

  return {
    version: SIGNALS_VERSION,
    computedAt: new Date(nowMs).toISOString(),
    phase,
    resolved,
    outcome,
    probability,
    probabilityChange,
    tape: tapeBlock,
    flow,
    volume,
    resolution,
    divergence,
    dataQuality: { grade, reasons },
    riskFlags,
    execution: { primaryOpen, lines },
    headline,
  };
}
