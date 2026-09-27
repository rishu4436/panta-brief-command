import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/panta/catalog-server";

/**
 * GET /api/catalog — the full live market catalog (REST list union + on-chain
 * Event accounts + detail for live markets). Read-only, no parameters.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const { payload, stale } = await getCatalog();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": stale ? "public, s-maxage=15" : "public, s-maxage=120, stale-while-revalidate=3600",
        ...(stale ? { "X-Catalog-Stale": "1" } : {}),
      },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : "catalog unavailable";
    return NextResponse.json({ error: "CATALOG_UNAVAILABLE", code: "CATALOG_UNAVAILABLE", detail }, { status: 502 });
  }
}
