import { NextRequest, NextResponse } from "next/server";
import { maybeOpenAIBrief } from "@/lib/brief";
import type {
  BriefTone,
  CatalogTradeRow,
  MarketCatalogItem,
  MarketTradesResponse,
} from "@/lib/types";

const UPSTREAM =
  process.env.PANTA_API_BASE_URL?.replace(/\/$/, "") ||
  "https://live-api.panta.market/api/v1";

async function pantaGet<T>(path: string): Promise<T> {
  const key = process.env.PANTA_API_KEY?.trim();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers["X-Api-Key"] = key;
  const res = await fetch(`${UPSTREAM}${path}`, {
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return JSON.parse(text) as T;
}

function parseTone(raw: unknown): BriefTone {
  const t = String(raw || "neutral").toLowerCase();
  if (t === "bull" || t === "bear" || t === "neutral") return t;
  return "neutral";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      marketId?: string;
      market?: MarketCatalogItem;
      tape?: CatalogTradeRow[];
      tone?: string;
    };

    let market = body.market;
    let tape = body.tape;
    const tone = parseTone(body.tone);

    if (!market && body.marketId) {
      market = await pantaGet<MarketCatalogItem>(
        `/markets/${encodeURIComponent(body.marketId)}/`,
      );
    }
    if (!market?.marketId) {
      return NextResponse.json(
        { code: "INVALID_REQUEST", detail: "market or marketId required" },
        { status: 400 },
      );
    }

    if (!tape) {
      try {
        const trades = await pantaGet<MarketTradesResponse>(
          `/markets/${encodeURIComponent(market.marketId)}/trades/`,
        );
        tape = trades.items || [];
      } catch {
        tape = [];
      }
    }

    const { narrative, source } = await maybeOpenAIBrief(market, tape, tone);
    return NextResponse.json({
      market,
      tape,
      narrative,
      source,
      tone,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "brief_failed";
    return NextResponse.json(
      { code: "BRIEF_FAILED", detail: message },
      { status: 500 },
    );
  }
}
