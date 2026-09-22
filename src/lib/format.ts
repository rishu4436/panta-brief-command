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

/** Prefer volumeUsdc, then totalVolumeUsdc; zero → empty. */
export function catalogVolume(
  m: {
    volumeUsdc?: string | number | null;
    totalVolumeUsdc?: string | number | null;
    volumeUsdcBase?: string | number | null;
    totalVolumeUsdcBase?: string | number | null;
  },
): string | number | null {
  const primary = m.volumeUsdc ?? m.totalVolumeUsdc;
  if (primary !== undefined && primary !== null && primary !== "") {
    const n = typeof primary === "string" ? Number(primary) : primary;
    if (Number.isFinite(n) && n > 0) return primary;
  }
  const base = m.volumeUsdcBase ?? m.totalVolumeUsdcBase;
  if (base !== undefined && base !== null && base !== "") {
    const u = fromUsdcBase(base);
    if (u != null && u > 0) return u;
  }
  return null;
}

/** USDC mint uses 6 decimals — convert raw base units when clearly base-scale. */
export function fromUsdcBase(
  v: string | number | null | undefined,
): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return null;
  // Heuristic: values >= 1000 without a decimal are almost always micro-USDC
  if (Math.abs(n) >= 1000 && Number.isInteger(n)) return n / 1_000_000;
  return n;
}

/** Human tape size: prefer amountUsdc, else base→USDC, else yes/no as shares/USDC. */
export function formatTapeSize(t: {
  amountUsdc?: string | number | null;
  amountUsdcBase?: string | number | null;
  yesAmount?: string | number | null;
  noAmount?: string | number | null;
}): string {
  if (t.amountUsdc != null && t.amountUsdc !== "") {
    const n = typeof t.amountUsdc === "string" ? Number(t.amountUsdc) : t.amountUsdc;
    if (Number.isFinite(n) && n > 0) return formatVolumeUsdc(n);
  }
  if (t.amountUsdcBase != null && t.amountUsdcBase !== "") {
    const u = fromUsdcBase(t.amountUsdcBase);
    if (u != null && u > 0) return formatVolumeUsdc(u);
  }
  const yRaw = t.yesAmount;
  const nRaw = t.noAmount;
  const y = fromUsdcBase(yRaw);
  const n = fromUsdcBase(nRaw);
  const yHas = y != null && y > 0;
  const nHas = n != null && n > 0;
  if (yHas || nHas) {
    const fmt = (v: number) =>
      v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (yHas && !nHas) return `${fmt(y!)} YES`;
    if (nHas && !yHas) return `${fmt(n!)} NO`;
    return `Y ${fmt(y ?? 0)} / N ${fmt(n ?? 0)}`;
  }
  if (yRaw != null || nRaw != null) {
    return `Y ${yRaw ?? "—"} / N ${nRaw ?? "—"}`;
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

export function impliedSide(market: {
  yesPrice?: string | null;
  noPrice?: string | null;
  primaryYesPrice?: string | null;
  primaryNoPrice?: string | null;
  secondaryYesPrice?: string | null;
  secondaryNoPrice?: string | null;
}): { yes: string | null; no: string | null } {
  const yes =
    market.yesPrice ??
    market.primaryYesPrice ??
    market.secondaryYesPrice ??
    null;
  const no =
    market.noPrice ?? market.primaryNoPrice ?? market.secondaryNoPrice ?? null;
  return { yes, no };
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
  return "Untitled market";
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
  /\b(prime\s*minister|president|parliament|election|congress|senate|mp\b|minister|defense|defence|spending\s+review|white\s*house|cabinet|ballot|referendum|governor)\b/i;
const SPORTS_RE =
  /\b(match|cup|league|fifa|nba|nfl|cricket|tennis|goal|championship|olympics|world\s*cup|vs\.?|versus)\b/i;

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
    POLITICS_RE.test(text) &&
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
