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
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
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
