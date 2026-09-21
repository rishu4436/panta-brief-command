import { MarketDetail } from "@/components/MarketDetail";

type Props = { params: Promise<{ marketId: string[] }> };

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export default async function MarketPage({ params }: Props) {
  const { marketId: parts } = await params;
  const marketId = (parts || []).map(decodeSegment).join("/");
  return <MarketDetail marketId={marketId} />;
}
