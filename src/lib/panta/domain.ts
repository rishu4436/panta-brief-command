/**
 * Brief Command domain types.
 *
 * Components consume these canonical shapes, never raw Panta responses. The
 * adapters in this folder (markets / orders / positions / claims /
 * attribution) parse each Panta response with zod and map it here.
 *
 * Known API values are typed unions; `(string & {})` keeps unknown future
 * values assignable (and visible in the UI) instead of crashing a parse.
 */

export type Side = "yes" | "no";

export type MarketPhase =
  | "primary"
  | "secondary"
  | "resolved"
  | "cancelled"
  | (string & {});

export type MarketStatus =
  | "primary"
  | "open"
  | "secondary"
  | "secondary_active"
  | "resolved"
  | "cancelled"
  | (string & {});

export type TradeKind = "buy" | "sell" | "claim" | (string & {});

/** POST /primaryorderverify/ status (docs: orders/verify). */
export type OrderStatus =
  | "built"
  | "submitted"
  | "confirmed"
  | "failed"
  | "expired"
  | (string & {});

/** POST /trades/ status (docs: trades/report). `processed` = attribution stored. */
export type TradeReportStatus = "processed" | "pending" | "failed" | (string & {});

/** What the desk shows for attribution. */
export type AttributionState = "reported" | "attributed";

export type ClaimKind = "win" | "creator-fees";

export type Market = {
  marketId: string;
  /** title, else the detail `question`, else "". */
  title: string;
  category: string;
  description?: string;
  /** On-chain resolution rule text (detail endpoint); often set when description is empty. */
  resolutionRule?: string;
  images?: string[];
  /** Lower-cased; "" when Panta omits it. */
  phase: MarketPhase;
  status?: MarketStatus;
  marketType?: string;
  startTime?: number | null;
  endTime?: number | null;
  resolutionTime?: number | null;
  region?: string;
  resolved?: boolean;
  /** Human decimals (strings keep precision) and 6-dec base units. */
  volumeUsdc?: string;
  volumeUsdcBase?: string | number;
  totalVolumeUsdc?: string;
  totalVolumeUsdcBase?: string | number;
  campaignId?: string | null;
  createdByPartner?: boolean;
  /** Probabilities as decimal strings in [0, 1], or null when unpriced. */
  yesPrice?: string | null;
  noPrice?: string | null;
  primaryYesPrice?: string | null;
  primaryNoPrice?: string | null;
  /** Live API returns these on a different scale (e.g. "500832640"); not probabilities. */
  secondaryYesPrice?: string | null;
  secondaryNoPrice?: string | null;
  creationFee?: number | string | null;
  creatorAddress?: string | null;
  oracle?: string | null;
  /**
   * True when the detail endpoint returned a partial record (no title,
   * question or prices) even after retries. See markets.ts.
   */
  partial?: boolean;
};

export type MarketPage = { items: Market[]; nextCursor: string | null };

/** One catalog tape print (GET /markets/{id}/trades/), human units. */
export type Trade = {
  id: string | null;
  marketId: string | null;
  wallet: string | null;
  signature: string | null;
  blockTime: number | null;
  isPrimary: boolean | null;
  kind: TradeKind | null;
  side: Side | null;
  /** Shares received, human units. null when the row carries no share size. */
  shares: number | null;
  /** USDC paid, human units. null when the row carries no USDC size. */
  amountUsdc: number | null;
};

export type IxAccount = { pubkey: string; isSigner: boolean; isWritable: boolean };
export type BuiltInstruction = { programId: string; data: string; accounts: IxAccount[] };

/** POST /primaryorderquote/ — amounts are human decimal strings (docs: orders). */
export type Quote = {
  quoteId: string;
  marketId: string;
  side: Side;
  amountUsdc: string;
  shares: string;
  avgPrice: string;
  feeUsdc: string;
  expiresAt: string;
  blockhashExpiryHintSec?: number;
};

/** POST /primaryorderbuild/ */
export type PrimaryBuild = {
  orderId: string;
  quoteId: string;
  wallet: string;
  marketId: string;
  side: Side | null;
  amountUsdc: string;
  expectedShares: string;
  feeUsdc: string;
  status: OrderStatus;
  instructions: BuiltInstruction[];
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  expiresAt?: string;
};

export type OrderVerify = { orderId?: string; status: OrderStatus | null; signature?: string };

/** GET /positions/?wallet= row. */
export type Position = {
  marketId: string;
  category: string | null;
  side: Side | null;
  /** Human share quantity (docs: positions) as a string, plus parsed number. */
  shares: string;
  sharesNum: number | null;
  phase: MarketPhase;
  claimable: boolean;
  claimed: boolean;
  outcome: string | null;
  title: string | null;
};

/** POST /claim/build/ or /claim/creator-fees/build/ */
export type ClaimBuild = {
  kind: ClaimKind;
  wallet: string;
  marketId: string;
  instructions: BuiltInstruction[];
  recentBlockhash: string;
  lastValidBlockHeight?: number;
  /** Win claims */
  outcome?: string;
  winningShares?: string;
  /** Creator-fee claims */
  claimableFeesUsdc?: string;
};

export type TradeReport = {
  signature: string;
  status: TradeReportStatus;
  marketId?: string;
  wallet?: string;
  side?: string;
  kind?: TradeKind;
};

/** GET /account/trades/ row (partner attribution). */
export type AccountTrade = {
  signature: string;
  wallet: string | null;
  marketId: string | null;
  side: Side | null;
  kind: TradeKind | null;
  /** Human USDC (amountUsdc, else amountUsdcBase ÷ 1e6). */
  amountUsdc: number | null;
  status: string | null;
  createdAt: string | null;
};

export type AccountTradesSummary = {
  total?: number;
  activityTotal?: number;
  buys?: number;
  claims?: number;
  volumeUsdc?: string;
  tradeVolumeUsdc?: string;
  activityValueUsdc?: string;
  unattributed?: number;
  byKind?: Record<string, number>;
};

export type AccountTrades = { summary: AccountTradesSummary | null; items: AccountTrade[] };
