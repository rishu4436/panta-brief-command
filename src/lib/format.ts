import {
  isSecondaryPhase,
  marketProbability,
  secondaryLastObservedPrices,
  type MarketProbability,
  type PriceFields,
  type ProbabilityUnavailableReason,
} from "./panta/prices";
import { marketVolumeUsdc } from "./panta/normalize";
import type { Trade } from "./panta/domain";

export function formatPrice(price: string | number | null | undefined): string {
  if (price === undefined || price === null || price === "") return "—";
  const n = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(n)) return String(price);
  return n.toFixed(4);
}

export function formatOddsPct(
  price: string | number | null | undefined,
): string {
  if (price === undefined || price === null || price === "") return "—";
  const n = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function formatVolumeUsdc(
  v: string | number | null | undefined,
): string {
  if (v === undefined || v === null || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return `${v} USDC`;
  // Cold-start honesty: bare 0 is not a traded book — don't paint "0 USDC"
  if (n === 0) return "—";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
}

/**
 * Prefer volumeUsdc, then totalVolumeUsdc; zero → empty.
 * Units are decided by field name in src/lib/panta/normalize.ts (no magnitude guessing).
 */
export function catalogVolume(
  m: {
    volumeUsdc?: string | null;
    totalVolumeUsdc?: string | null;
    volumeUsdcBase?: string | number | null;
    totalVolumeUsdcBase?: string | number | null;
  },
): number | null {
  return marketVolumeUsdc({
    volumeUsdc: m.volumeUsdc ?? undefined,
    totalVolumeUsdc: m.totalVolumeUsdc ?? undefined,
    volumeUsdcBase: m.volumeUsdcBase ?? undefined,
    totalVolumeUsdcBase: m.totalVolumeUsdcBase ?? undefined,
  });
}

/**
 * Human tape size from a normalized Trade: USDC paid when the row carries it,
 * else shares received (labelled by side). Never infers units from magnitude.
 */
export function formatTapeSize(n: Trade): string {
  if (n.amountUsdc != null) return formatVolumeUsdc(n.amountUsdc);
  if (n.shares != null) {
    const qty = n.shares.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return n.side ? `${qty} ${n.side.toUpperCase()}` : `${qty} sh`;
  }
  return "—";
}

export function shortAddr(addr?: string | null, n = 4): string {
  if (!addr) return "—";
  if (addr.length <= n * 2 + 2) return addr;
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

export function formatBlockTime(blockTime?: number | null): string {
  if (!blockTime) return "—";
  return new Date(blockTime * 1000).toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Relative time for tape rows (falls back to absolute IST). */
export function formatRelativeTime(
  blockTime?: number | null,
  nowMs: number = Date.now(),
): string {
  if (!blockTime) return "—";
  const then = blockTime * 1000;
  const diffSec = Math.round((nowMs - then) / 1000);
  if (!Number.isFinite(diffSec)) return formatBlockTime(blockTime);
  const abs = Math.abs(diffSec);
  const ago = diffSec >= 0;
  let label: string;
  if (abs < 60) label = `${abs}s`;
  else if (abs < 3600) label = `${Math.floor(abs / 60)}m`;
  else if (abs < 86400) label = `${Math.floor(abs / 3600)}h`;
  else if (abs < 86400 * 14) label = `${Math.floor(abs / 86400)}d`;
  else return formatBlockTime(blockTime);
  return ago ? `${label} ago` : `in ${label}`;
}

/** Friendly IST timestamp (not raw ISO). */
export function formatFriendlyIst(
  isoOrMs: string | number | Date | null | undefined,
): string {
  if (isoOrMs == null || isoOrMs === "") return "—";
  const d =
    typeof isoOrMs === "number"
      ? new Date(isoOrMs)
      : isoOrMs instanceof Date
        ? isoOrMs
        : new Date(isoOrMs);
  if (!Number.isFinite(d.getTime())) return "—";
  return (
    d.toLocaleString("en-IN", {
      timeZone: "Asia/Calcutta",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " IST"
  );
}

/**
 * Implied YES/NO probability for display, validated by the single price layer
 * (src/lib/panta/prices.ts). `yes`/`no` are null whenever Panta's prices are
 * missing, one-sided or inconsistent; `unavailable` says why.
 */
export function impliedSide(market: PriceFields): {
  yes: string | null;
  no: string | null;
  unavailable: ProbabilityUnavailableReason | null;
  probability: MarketProbability;
} {
  const p = marketProbability(market);
  return {
    yes: p.yes == null ? null : String(p.yes),
    no: p.no == null ? null : String(p.no),
    unavailable: p.reason,
    probability: p,
  };
}


/**
 * Desk / rail price cell: probabilities for primary; independent last-observed
 * secondary USDC prices for secondary — never a % for secondary.
 */
export type DeskPriceDisplay =
  | {
      mode: "probability";
      yes: string;
      no: string;
      unavailable: null;
      probability: MarketProbability;
    }
  | {
      mode: "secondary";
      yesLabel: string;
      noLabel: string;
      yes: number | null;
      no: number | null;
      unavailable: null;
      probability: MarketProbability;
    }
  | {
      mode: "unavailable";
      yes: null;
      no: null;
      unavailable: ProbabilityUnavailableReason;
      probability: MarketProbability;
      secondaryHint?: boolean;
    };

export function formatUsdcPerShare(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 2 })} USDC`;
}

export function deskPriceDisplay(market: PriceFields): DeskPriceDisplay {
  const probability = marketProbability(market);
  if (isSecondaryPhase(market) && !market.resolved) {
    const obs = secondaryLastObservedPrices(market);
    if (obs.yes == null && obs.no == null) {
      return {
        mode: "unavailable",
        yes: null,
        no: null,
        unavailable: probability.reason ?? "missing_prices",
        probability,
        secondaryHint: true,
      };
    }
    return {
      mode: "secondary",
      yesLabel: obs.yes == null ? "—" : formatUsdcPerShare(obs.yes),
      noLabel: obs.no == null ? "—" : formatUsdcPerShare(obs.no),
      yes: obs.yes,
      no: obs.no,
      unavailable: null,
      probability,
    };
  }
  if (probability.yes == null || probability.no == null) {
    return {
      mode: "unavailable",
      yes: null,
      no: null,
      unavailable: probability.reason ?? "missing_prices",
      probability,
    };
  }
  return {
    mode: "probability",
    yes: String(probability.yes),
    no: String(probability.no),
    unavailable: null,
    probability,
  };
}


/** True when API gave no human question/title. */
export function isUntitledMarket(market: {
  title?: string | null;
  description?: string | null;
}): boolean {
  return !(market.title || "").trim() && !(market.description || "").trim();
}

/** Prefer human title/description; never lead with opaque id alone. */
export function marketLabel(
  market: {
    title?: string | null;
    description?: string | null;
    marketId?: string | null;
    category?: string | null;
  },
  opts?: { max?: number },
): string {
  const title = (market.title || "").trim();
  if (title) return opts?.max ? truncate(title, opts.max) : title;
  const desc = (market.description || "").trim();
  if (desc) return opts?.max ? truncate(desc, opts.max) : desc;
  // Honest untitled — short id lives in the subtitle, not the headline
  return "Title unavailable";
}

/** Secondary line under the headline: short id · never duplicates the label. */
export function marketSubtitle(
  market: {
    title?: string | null;
    description?: string | null;
    marketId?: string | null;
    category?: string | null;
  },
): string {
  const id = (market.marketId || "").trim();
  if (!id) return "";
  return shortAddr(id, 4);
}

/** Spot present (not null/empty). Zero is a real resolved outcome — keep it. */
export function hasSpotPrice(
  price: string | number | null | undefined,
): boolean {
  if (price === undefined || price === null || price === "") return false;
  const n = typeof price === "string" ? Number(price) : price;
  return Number.isFinite(n);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

const POLITICS_RE =
  /\b(prime\s*minister|president(ial)?|nomination|parliament|election|congress|senate|mp\b|minister|defense|defence|spending\s+review|white\s*house|cabinet|ballot|referendum|governor)\b/i;
const SPORTS_RE =
  /\b(match|cup|league|fifa|nba|nfl|cricket|tennis|goal|championship|olympics|world\s*cup|vs\.?|versus)\b/i;

// Finance / crypto wording. Panta files many non-sports markets (token prices,
// company valuations) under its default "sports" category.
const FINANCE_RE =
  /\b(bitcoin|btc|ethereum|eth|solana|sol|zcash|zec|crypto|token|memecoin|coin|market\s*cap(italization)?|valued|valuation|price[ds]?|stock|shares|ipo|nasdaq|s&p|usd|billion|trillion)\b|\$[a-z]{2,}|\$\d/i;

/** Display label for a Panta category slug: "sports" → "Sports", "pop-culture" → "Pop Culture". */
export function categoryLabel(category?: string | null): string {
  return (category || "")
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Show category chip as API returned, but hide when clearly misleading
 * (e.g. sports chip on a politics-titled market). Conservative — leave API
 * truth when unsure.
 */
export function shouldShowCategoryChip(
  category?: string | null,
  title?: string | null,
  description?: string | null,
): boolean {
  const cat = (category || "").trim();
  if (!cat) return false;
  const text = `${title || ""} ${description || ""}`.trim();
  if (!text) return true;
  const catL = cat.toLowerCase();
  if (
    (catL === "sports" || catL === "sport") &&
    (POLITICS_RE.test(text) || FINANCE_RE.test(text)) &&
    !SPORTS_RE.test(text)
  ) {
    return false;
  }
  if (
    (catL === "politics" || catL === "political") &&
    SPORTS_RE.test(text) &&
    !POLITICS_RE.test(text)
  ) {
    return false;
  }
  return true;
}

/** Rank for live strip: prefer primary/active over cancelled/resolved. */
export function marketActivityRank(m: {
  phase?: string | null;
  status?: string | null;
  resolved?: boolean | null;
}): number {
  const phase = (m.phase || "").toLowerCase();
  const status = (m.status || "").toLowerCase();
  if (m.resolved || phase === "resolved" || status === "resolved") return 3;
  if (
    phase === "cancelled" ||
    status === "cancelled" ||
    phase === "canceled" ||
    status === "canceled"
  )
    return 4;
  if (phase === "primary" || status === "primary") return 0;
  if (phase === "secondary" || status === "secondary" || phase === "active")
    return 1;
  return 2;
}

/**
 * Shared resolution / remaining countdown used by Book, Secondary Intelligence,
 * signals risk text, and AI brief — so all surfaces agree (e.g. "1h 42m", not "2h").
 */
export function formatResolutionCountdown(totalSec: number): string {
  if (totalSec <= 0) return "0m";
  const d = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  if (d >= 1) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h >= 1) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** Remaining duration from minutes (fractional OK); null when unknown. */
export function formatCountdownMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  if (minutes <= 0) return "0m";
  return formatResolutionCountdown(minutes * 60);
}
