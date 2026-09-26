/**
 * Server-side sanitizers for Panta data fed to the AI brief.
 * Upstream text (titles, descriptions) is third-party content, so it is capped
 * and stripped of control characters before it reaches a prompt.
 */

import "server-only";
import type { Market, Trade } from "./domain";

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

/** Re-emit a parsed Market with capped, control-char-free text fields. */
export function sanitizeMarket(raw: Market): Market {
  const description = cleanStr(raw.description, BRIEF_LIMITS.descriptionBytes * 4);
  const resolutionRule = cleanStr(raw.resolutionRule, BRIEF_LIMITS.descriptionBytes * 4);
  return {
    marketId: cleanStr(raw.marketId, 64) || "",
    category: cleanStr(raw.category) || "",
    title: cleanStr(raw.title) || "",
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
    partial: raw.partial || undefined,
  };
}

/** Cap to BRIEF_LIMITS.tapeRows and clean the string fields of parsed trades. */
export function sanitizeTape(trades: Trade[]): Trade[] {
  return trades.slice(0, BRIEF_LIMITS.tapeRows).map((t) => ({
    id: cleanStr(t.id, 64) ?? null,
    marketId: cleanStr(t.marketId, 64) ?? null,
    wallet: cleanStr(t.wallet, 64) ?? null,
    signature: cleanStr(t.signature, 100) ?? null,
    blockTime: numOrNull(t.blockTime),
    isPrimary: t.isPrimary,
    kind: cleanStr(t.kind, 32) ?? null,
    side: t.side,
    shares: t.shares,
    amountUsdc: t.amountUsdc,
  }));
}
