/**
 * Book "Activity" = Panta's attribution ledger for this app's API key
 * (GET /account/trades/): rows from EVERY wallet that traded through the app,
 * not only the connected one. Panta offers no wallet filter on that endpoint,
 * but each row carries its `wallet`, so "My wallet" is a client-side filter
 * over the page that was fetched (the latest N app-wide rows).
 */

export type ActivityScope = "app" | "wallet";

export type WalletTag = "you" | "other" | "unknown";

export function walletTag(rowWallet: string | null | undefined, connected: string | null | undefined): WalletTag {
  if (!rowWallet) return "unknown";
  return connected && rowWallet === connected ? "you" : "other";
}

export const WALLET_TAG_LABEL: Record<WalletTag, string> = { you: "You", other: "Other wallet", unknown: "Unknown" };

export function scopeActivity<T extends { wallet?: string | null }>(
  rows: T[],
  scope: ActivityScope,
  connected: string | null | undefined,
): { rows: T[]; scope: ActivityScope; hidden: number } {
  // Without a connected wallet there is nothing to filter by: show the app-wide view, labelled as such.
  if (scope === "app" || !connected) return { rows, scope: "app", hidden: 0 };
  const mine = rows.filter((r) => r.wallet === connected);
  return { rows: mine, scope: "wallet", hidden: rows.length - mine.length };
}

export function activityScopeNote(scope: ActivityScope, limit: number, connectedShort: string | null): string {
  return scope === "app"
    ? "App-wide: every trade Panta has attributed to this app (GET /account/trades/), from all wallets, not just yours. A transaction can be confirmed on Solana before it shows here."
    : `Your wallet${connectedShort ? ` (${connectedShort})` : ""} only, filtered from the latest ${limit} app-wide rows, so older trades of yours may not be listed. A transaction can be confirmed on Solana before it shows here.`;
}
