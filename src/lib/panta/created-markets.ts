/**
 * Local evidence of markets this browser created and Panta registered (Stage D).
 *
 * Written once, from the checked registration receipt (POST /markets/register
 * returned status "registered" and a marketId equal to the quoted Event PDA;
 * see create-market.ts checkRegisterResponse). It is evidence that a market
 * exists while Panta's catalog catches up. It is never turned into a Market
 * row, price or tradable state, and it is pruned once Panta returns the market.
 *
 * Case 3 (confirmed, registration needs attention) is read from the existing
 * create recovery record (create-recovery.ts) and is not stored here.
 */

import { z } from "@/lib/zod";
import type { CreateRecoveryRecord } from "./create-recovery";
import { BASE58_PUBKEY_RE } from "./routes";

export const CREATED_MARKETS_KEY = "panta-brief:created-markets";
export const CREATED_MARKETS_MAX = 20;
/** Evidence older than this is dropped (Panta indexes within minutes). */
export const CREATED_MARKETS_TTL_MS = 14 * 24 * 3600_000;

const RecordSchema = z.strictObject({
  marketId: z.string().regex(BASE58_PUBKEY_RE),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
  question: z.string().max(512).nullable(),
  registeredAt: z.number().int().positive(),
});
export type CreatedMarketRecord = z.infer<typeof RecordSchema>;

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function parseCreatedMarkets(raw: string | null, now: number): CreatedMarketRecord[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: CreatedMarketRecord[] = [];
    for (const item of arr) {
      const r = RecordSchema.safeParse(item);
      if (r.success && now - r.data.registeredAt < CREATED_MARKETS_TTL_MS && !out.some((o) => o.marketId === r.data.marketId)) {
        out.push(r.data);
      }
    }
    return out.slice(0, CREATED_MARKETS_MAX);
  } catch {
    return [];
  }
}

export function createdMarketsStore(kv: () => KV | null, clock: () => number = () => Date.now()) {
  const read = () => {
    try {
      return parseCreatedMarkets(kv()?.getItem(CREATED_MARKETS_KEY) ?? null, clock());
    } catch {
      return [];
    }
  };
  const write = (rows: CreatedMarketRecord[]) => {
    try {
      kv()?.setItem(CREATED_MARKETS_KEY, JSON.stringify(rows.slice(0, CREATED_MARKETS_MAX)));
    } catch {
      /* storage full / disabled: evidence is best-effort */
    }
  };
  return {
    list: read,
    get: (marketId: string) => read().find((r) => r.marketId === marketId) ?? null,
    /** From a checked registration receipt only. false when the input is malformed. */
    remember(rec: { marketId: string; signature: string; question?: string | null }): boolean {
      const r = RecordSchema.safeParse({
        marketId: rec.marketId,
        signature: rec.signature,
        question: rec.question ? rec.question.slice(0, 512) : null,
        registeredAt: Math.max(1, Math.floor(clock())),
      });
      if (!r.success) return false;
      write([r.data, ...read().filter((x) => x.marketId !== r.data.marketId)]);
      return true;
    },
    /** Drop evidence for markets Panta now returns (normal lifecycle takes over). */
    prune(indexedIds: Iterable<string>): void {
      const ids = new Set(indexedIds);
      const rows = read();
      const keep = rows.filter((r) => !ids.has(r.marketId));
      if (keep.length !== rows.length) write(keep);
    },
  };
}

export const browserCreatedMarkets = createdMarketsStore(() => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
});

/** Created + registered markets that Panta's catalog doesn't list yet. */
export function awaitingIndexing(records: CreatedMarketRecord[], catalogIds: ReadonlySet<string>): CreatedMarketRecord[] {
  return records.filter((r) => !catalogIds.has(r.marketId));
}

/** Case 3: a create recovery record whose registration isn't done (never tradable). */
export function needsRegistration(rec: CreateRecoveryRecord | null | undefined): boolean {
  return Boolean(rec && (rec.stage === "confirmed" || rec.stage === "registration_needs_attention"));
}
