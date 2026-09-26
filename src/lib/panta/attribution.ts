/**
 * Attribution adapter: POST /trades/ (report) and GET /account/trades/
 * (partner ledger).
 *
 * Vocabulary used across the desk:
 * - "reported"   → POST /trades/ accepted, attribution not confirmed yet
 * - "attributed" → POST /trades/ returned `processed` ("when attribution is
 *                  stored", docs trades/report) or the signature is listed in
 *                  GET /account/trades/
 */

import { z } from "zod";
import type { Json } from "@/lib/types";
import { devWarn, numish, optNum, optStr, pantaFetch, parseOrNull } from "./client";
import type {
  AccountTrades,
  AttributionState,
  TradeKind,
  TradeReport,
  TradeReportStatus,
} from "./domain";
import { normalizeAccountTrade } from "./normalize";

/** `processed` is the only POST /trades/ status treated as definitive. */
export function attributionFromReport(status: string | null | undefined): AttributionState {
  return String(status || "").toLowerCase() === "processed" ? "attributed" : "reported";
}

const RawReportSchema = z.looseObject({
  signature: optStr,
  status: optStr,
  marketId: optStr,
  wallet: optStr,
  side: optStr,
  kind: optStr,
});

export function parseTradeReport(raw: unknown, signature: string): TradeReport {
  const r = parseOrNull(RawReportSchema, raw, "trade report");
  return {
    signature: r?.signature || signature,
    status: (r?.status || "").toLowerCase() as TradeReportStatus,
    marketId: r?.marketId ?? undefined,
    wallet: r?.wallet ?? undefined,
    side: r?.side ?? undefined,
    kind: (r?.kind?.toLowerCase() as TradeKind | undefined) ?? undefined,
  };
}

const RawAccountTradeSchema = z.looseObject({
  signature: z.string().min(1),
  wallet: optStr,
  marketId: optStr,
  side: optStr,
  kind: optStr,
  amountUsdc: numish,
  amountUsdcBase: numish,
  status: optStr,
  createdAt: optStr,
});

const RawSummarySchema = z.looseObject({
  total: optNum,
  activityTotal: optNum,
  buys: optNum,
  claims: optNum,
  volumeUsdc: numish,
  tradeVolumeUsdc: numish,
  activityValueUsdc: numish,
  unattributed: optNum,
  byKind: z.record(z.string(), z.number()).nullish().catch(undefined),
});

const RawAccountTradesSchema = z.looseObject({
  summary: z.unknown().optional(),
  items: z.array(z.unknown()).catch([]),
});

const s = (v: string | number | null | undefined) => (v == null ? undefined : String(v));

export function parseAccountTrades(raw: unknown): AccountTrades {
  const page = parseOrNull(RawAccountTradesSchema, raw, "account trades");
  if (!page) return { summary: null, items: [] };
  const items = [];
  for (const row of page.items) {
    const r = RawAccountTradeSchema.safeParse(row);
    if (r.success) items.push(normalizeAccountTrade(r.data));
    else devWarn("account trades: dropped a row without a signature");
  }
  const sum = page.summary == null ? null : RawSummarySchema.safeParse(page.summary);
  const summary =
    sum && sum.success
      ? {
          total: sum.data.total ?? undefined,
          activityTotal: sum.data.activityTotal ?? undefined,
          buys: sum.data.buys ?? undefined,
          claims: sum.data.claims ?? undefined,
          volumeUsdc: s(sum.data.volumeUsdc),
          tradeVolumeUsdc: s(sum.data.tradeVolumeUsdc),
          activityValueUsdc: s(sum.data.activityValueUsdc),
          unattributed: sum.data.unattributed ?? undefined,
          byKind: sum.data.byKind ?? undefined,
        }
      : null;
  return { summary, items };
}

export async function reportTrade(
  input: {
    signature: string;
    wallet: string;
    marketId: string;
    quoteId?: string;
    clientOrderId?: string;
  },
  userId?: string,
): Promise<{ report: TradeReport; state: AttributionState; raw: Json }> {
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) if (v) body[k] = v;
  if (userId) body.userId = userId;
  const { data, raw } = await pantaFetch("/trades/", { method: "POST", userId, body });
  const report = parseTradeReport(data, input.signature);
  return { report, state: attributionFromReport(report.status), raw };
}

export async function fetchAccountTrades(params: {
  limit?: number;
  kind?: "buy" | "claim" | "";
}): Promise<AccountTrades> {
  const { data } = await pantaFetch("/account/trades/", {
    query: {
      limit: params.limit ? String(params.limit) : undefined,
      kind: params.kind || undefined,
    },
  });
  return parseAccountTrades(data);
}

/** True when `signature` is listed in the attribution ledger. */
export async function isInLedger(signature: string, kind: "buy" | "claim"): Promise<boolean> {
  const { items } = await fetchAccountTrades({ limit: 50, kind });
  return items.some((row) => row.signature === signature);
}
