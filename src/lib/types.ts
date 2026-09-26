import type { Market, Trade } from "./panta/domain";
import type { MarketSignals } from "./panta/signals";

export type {
  AccountTrade,
  AccountTrades,
  AccountTradesSummary,
  AttributionState,
  BuiltInstruction,
  ClaimBuild,
  ClaimKind,
  IxAccount,
  Market,
  MarketPage,
  MarketPhase,
  MarketStatus,
  OrderStatus,
  Position,
  PrimaryBuild,
  Quote,
  Side,
  Trade,
  TradeKind,
  TradeReport,
} from "./panta/domain";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** Analytical brief modes (replaces Bull/Neutral/Bear). */
export type BriefMode = "desk" | "flow" | "risk" | "catalysts";

export type BriefPayload = {
  market: Market;
  tape: Trade[];
  signals: MarketSignals;
  narrative: string;
  source: "openai" | "template";
  mode: BriefMode;
  generatedAt: string;
  cached?: boolean;
};
