export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type MarketCatalogItem = {
  marketId: string;
  category: string;
  title: string;
  description?: string;
  /** On-chain resolution rule text (detail endpoint); often set when description is empty. */
  resolutionRule?: string;
  images?: string[];
  phase: string;
  marketType?: string;
  startTime?: number | null;
  endTime?: number | null;
  resolutionTime?: number | null;
  region?: string;
  resolved?: boolean;
  status?: string;
  volumeUsdc?: string;
  volumeUsdcBase?: string | number;
  totalVolumeUsdc?: string;
  totalVolumeUsdcBase?: string | number;
  campaignId?: string | null;
  createdByPartner?: boolean;
  yesPrice?: string | null;
  noPrice?: string | null;
  primaryYesPrice?: string | null;
  primaryNoPrice?: string | null;
  secondaryYesPrice?: string | null;
  secondaryNoPrice?: string | null;
  creationFee?: number | string | null;
  creatorAddress?: string | null;
  oracle?: string | null;
};

export type MarketsListResponse = {
  items: MarketCatalogItem[];
  nextCursor?: string | null;
};

export type CategoriesResponse = {
  categories: string[];
};

export type CatalogTradeRow = {
  id?: string | number;
  marketId?: string;
  wallet?: string;
  isPrimary?: boolean;
  yesAmount?: string | number;
  noAmount?: string | number;
  feePaid?: string | number;
  blockTime?: number | null;
  signature?: string;
  quoteAsset?: string;
  kind?: string;
  side?: string;
  amountUsdc?: string;
  amountUsdcBase?: string | number;
};

export type MarketTradesResponse = {
  marketId: string;
  items: CatalogTradeRow[];
};

export type PrimaryQuoteResponse = {
  quoteId: string;
  marketId: string;
  side: string;
  amountUsdc: string;
  shares: string;
  avgPrice: string;
  feeUsdc: string;
  expiresAt: string;
  blockhashExpiryHintSec?: number;
};

export type IxAccount = {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
};

export type BuiltInstruction = {
  programId: string;
  data: string;
  accounts: IxAccount[];
};

export type PrimaryBuildResponse = {
  orderId: string;
  quoteId: string;
  wallet: string;
  marketId: string;
  side: string;
  amountUsdc: string;
  expectedShares: string;
  feeUsdc: string;
  status: string;
  instructions: BuiltInstruction[];
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  expiresAt?: string;
};

export type PositionRow = {
  marketId: string;
  category?: string | null;
  side: string;
  shares: string;
  phase: string;
  claimable: boolean;
  claimed: boolean;
  outcome?: string | null;
  title?: string | null;
};

export type PositionsResponse = {
  wallet: string;
  positions: PositionRow[];
};

export type ClaimBuildResponse = {
  wallet: string;
  marketId: string;
  outcome: string;
  winningShares: string;
  instructions: BuiltInstruction[];
  derived?: Record<string, string>;
  recentBlockhash: string;
  lastValidBlockHeight?: number;
};

export type CreatorFeesClaimBuildResponse = {
  wallet: string;
  marketId: string;
  claimableFeesUsdc: string;
  instructions: BuiltInstruction[];
  derived?: Record<string, string>;
  recentBlockhash: string;
  lastValidBlockHeight?: number;
};

export type TradeReportResponse = {
  signature: string;
  status: string;
  marketId?: string;
  wallet?: string;
  side?: string;
  kind?: string;
};

export type BriefTone = "bull" | "neutral" | "bear";

export type BriefPayload = {
  market: MarketCatalogItem;
  tape: CatalogTradeRow[];
  narrative: string;
  source: "openai" | "template";
  generatedAt: string;
};

/** GET /account/trades/ — partner attribution (docs.panta.market) */
export type AccountTradeItem = {
  signature: string;
  wallet?: string;
  marketId?: string;
  side?: string;
  kind?: string;
  amountUsdc?: string;
  amountUsdcBase?: string | number;
  status?: string;
  createdAt?: string;
};

export type AccountTradesSummary = {
  total?: number;
  activityTotal?: number;
  buys?: number;
  claims?: number;
  volumeUsdc?: string;
  volumeUsdcBase?: number;
  tradeVolumeUsdc?: string;
  tradeVolumeUsdcBase?: number;
  claimPayoutUsdc?: string;
  claimPayoutUsdcBase?: number;
  activityValueUsdc?: string;
  activityValueUsdcBase?: number;
  zeroAmountBuys?: number;
  unattributed?: number;
  byKind?: Record<string, number>;
};

export type AccountTradesResponse = {
  summary?: AccountTradesSummary;
  items: AccountTradeItem[];
};
