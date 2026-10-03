/**
 * Wording for the two wallet-concentration metrics (client + server safe).
 * Print concentration counts trades per wallet; size concentration weighs by
 * traded shares/USDC and is unknown unless every wallet print has a size.
 */

import type { MarketSignals } from "./panta/signals";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Print concentration counts trades per wallet, not size. */
export function printConcentrationLine(s: MarketSignals): string {
  const c = s.tape.printConcentration;
  if (c.topWalletShareOfPrints == null) return "Print concentration: unknown (no prints with a wallet).";
  return `Print concentration: top wallet made ${pct(c.topWalletShareOfPrints)} of prints (${c.wallets} wallet${c.wallets === 1 ? "" : "s"}; counts trades, not size).`;
}

/** Share-weighted concentration; unknown unless every wallet print has a size. */
export function sizeConcentrationLine(s: MarketSignals): string {
  const c = s.tape.sizeConcentration;
  if (c.topWalletShareOfSize == null) return `Size concentration: unknown — ${c.reason ?? "no trade sizes"}.`;
  return `Size concentration: top wallet holds ${pct(c.topWalletShareOfSize)} of traded ${c.basis === "usdc" ? "USDC" : "shares"}.`;
}

