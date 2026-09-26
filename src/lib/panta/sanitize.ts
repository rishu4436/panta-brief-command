/**
 * Server-side sanitizers for Panta data fed to the AI brief.
 * Upstream text (titles, descriptions) is third-party content, so it is capped
 * and stripped of control characters before it reaches a prompt.
 */

import type { CatalogTradeRow, MarketCatalogItem } from "@/lib/types";
import { normalizePantaTrade } from "./normalize";

export const BRIEF_LIMITS = {
  /** Max UTF-8 bytes of market description. */
  descriptionBytes: 4 * 1024,
  /** Max chars for any other string field. */
  fieldChars: 500,
  /** Max tape rows. */
  tapeRows: 20,
} as const;

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanStr(v: unknown, maxChars: number = BRIEF_LIMITS.fieldChars): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(CONTROL_RE, "").trim();
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}

function capBytes(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).byteLength <= maxBytes) return s;
  // Trim by code points until it fits (description is at most a few KB).
  let out = s;
  while (out.length && enc.encode(out).byteLength > maxBytes) {
    out = out.slice(0, Math.floor(out.length * 0.9));
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

/** Price-like field: keep only if it parses as a finite number. */
function priceStr(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).slice(0, 32);
  return Number.isFinite(Number(s)) ? s : null;
}

export function sanitizeMarket(raw: MarketCatalogItem): MarketCatalogItem {
  const description = cleanStr(raw.description, BRIEF_LIMITS.descriptionBytes * 4);
  const resolutionRule = cleanStr(raw.resolutionRule, BRIEF_LIMITS.descriptionBytes * 4);
  return {
    marketId: cleanStr(raw.marketId, 64) || "",
    category: cleanStr(raw.category) || "",
    // Detail responses carry `question` too; use it when `title` is blank.
    title: cleanStr(raw.title) || cleanStr((raw as { question?: unknown }).question) || "",
    description: description ? capBytes(description, BRIEF_LIMITS.descriptionBytes) : undefined,
    resolutionRule: resolutionRule ? capBytes(resolutionRule, BRIEF_LIMITS.descriptionBytes) : undefined,
    phase: cleanStr(raw.phase, 32) || "",
    status: cleanStr(raw.status, 32),
    region: cleanStr(raw.region, 64),
    resolved: typeof raw.resolved === "boolean" ? raw.resolved : undefined,
    marketType: cleanStr(raw.marketType, 32),
    startTime: numOrNull(raw.startTime),
    endTime: numOrNull(raw.endTime),
    resolutionTime: numOrNull(raw.resolutionTime),
    volumeUsdc: priceStr(raw.volumeUsdc) ?? undefined,
    totalVolumeUsdc: priceStr(raw.totalVolumeUsdc) ?? undefined,
    yesPrice: priceStr(raw.yesPrice),
    noPrice: priceStr(raw.noPrice),
    primaryYesPrice: priceStr(raw.primaryYesPrice),
    primaryNoPrice: priceStr(raw.primaryNoPrice),
    secondaryYesPrice: priceStr(raw.secondaryYesPrice),
    secondaryNoPrice: priceStr(raw.secondaryNoPrice),
    oracle: cleanStr(raw.oracle) ?? null,
  };
}

/**
 * Cap to BRIEF_LIMITS.tapeRows and rebuild each row from normalized fields only
 * (side, shares, USDC, time). Unknown upstream fields are dropped.
 */
export function sanitizeTape(raw: unknown): CatalogTradeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, BRIEF_LIMITS.tapeRows).map((row) => {
    const n = normalizePantaTrade((row || {}) as CatalogTradeRow);
    const out: CatalogTradeRow & { shares?: string } = {
      marketId: cleanStr(n.marketId, 64),
      wallet: cleanStr(n.wallet, 64),
      signature: cleanStr(n.signature, 100),
      blockTime: n.blockTime,
      isPrimary: n.isPrimary ?? undefined,
      kind: cleanStr(n.kind, 32),
      side: n.side ?? undefined,
      amountUsdc: n.amountUsdc != null ? String(n.amountUsdc) : undefined,
      shares: n.shares != null ? String(n.shares) : undefined,
    };
    return out;
  });
}
