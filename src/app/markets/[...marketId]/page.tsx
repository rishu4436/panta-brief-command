import type { Metadata } from "next";
import { MarketDetail } from "@/components/MarketDetail";
import { marketLabel } from "@/lib/format";
import { pantaServerGet } from "@/lib/panta-server";
import type { MarketCatalogItem } from "@/lib/types";

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
  const market = marketId
    ? await pantaServerGet<MarketCatalogItem>(
        `/markets/${encodeURIComponent(marketId)}/`,
      )
    : null;

  const label = market
    ? marketLabel(market, { max: 90 })
    : marketId
      ? `Market ${marketId.slice(0, 12)}…`
      : "Market";

  const phase = market?.phase ? ` · ${market.phase}` : "";
  const descBits = [
    market?.description?.trim() || null,
    market?.category ? `Category: ${market.category}` : null,
    market?.phase ? `Phase: ${market.phase}` : null,
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
