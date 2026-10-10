import type { Metadata } from "next";
import { MarketDetail } from "@/components/MarketDetail";
import { categoryLabel, marketLabel, shouldShowCategoryChip } from "@/lib/format";
import { LIFECYCLE_LABEL, marketLifecycle, resolveAuthoritativeMarket } from "@/lib/panta/catalog";
import { peekCatalog } from "@/lib/panta/catalog-server";
import { getMarketServerSoft } from "@/lib/panta/server";

type Props = { params: Promise<{ marketId: string[] }> };

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function resolveId(parts: string[] | undefined): string {
  return (parts || []).map(decodeSegment).join("/");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { marketId: parts } = await params;
  const marketId = resolveId(parts);
  // Same authority as the page: the cached catalog / on-chain row (non-blocking
  // peek) merged with the detail record, so a stale or thin Panta detail can't
  // put a wrong title or phase in the browser tab.
  const row = marketId ? peekCatalog()?.payload.items.find((m) => m.marketId === marketId) : undefined;
  const detail = marketId ? await getMarketServerSoft(marketId) : null;
  const market = resolveAuthoritativeMarket(row, detail);

  const titled = market ? marketLabel(market, { max: 90 }) : null;
  const label =
    titled && titled !== "Title unavailable" ? titled : marketId ? `Market ${marketId.slice(0, 12)}…` : "Market";

  const lc = market ? marketLifecycle(market) : "unknown";
  const stateText =
    lc === "unknown" ? null : lc === "resolved" && market?.outcome ? `Resolved · ${market.outcome.toUpperCase()}` : LIFECYCLE_LABEL[lc];
  const phase = stateText ? ` · ${stateText}` : "";
  const showCategory = market ? shouldShowCategoryChip(market.category, market.title, market.description) : false;
  const descBits = [
    market?.description?.trim() || null,
    showCategory ? `Category: ${categoryLabel(market?.category)}` : null,
    stateText ? `Status: ${stateText}` : null,
    "Live Solana prediction market · Powered by Panta",
  ].filter(Boolean);
  const description = descBits.join(" · ").slice(0, 200);

  const shortTitle = `${label}${phase}`;
  const fullTitle = `${shortTitle} | Brief Command`;

  return {
    title: shortTitle,
    description,
    openGraph: {
      title: fullTitle,
      description,
      type: "website",
      siteName: "Brief Command",
    },
    twitter: {
      card: "summary",
      title: fullTitle,
      description,
    },
  };
}

export default async function MarketPage({ params }: Props) {
  const { marketId: parts } = await params;
  const marketId = resolveId(parts);
  return <MarketDetail marketId={marketId} />;
}
