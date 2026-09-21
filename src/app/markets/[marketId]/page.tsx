import { MarketDetail } from "@/components/MarketDetail";

type Props = { params: Promise<{ marketId: string }> };

export default async function MarketPage({ params }: Props) {
  const { marketId } = await params;
  return <MarketDetail marketId={decodeURIComponent(marketId)} />;
}
