/**
 * Wallet menu items (pure; tested). "Sign out" ends the Brief Command room
 * session only (the wallet stays connected); it appears only while the server
 * reports a signed-in session. "Disconnect" disconnects the wallet adapter.
 */
export type WalletMenuItem = "copy" | "solscan" | "sign-out" | "disconnect";

export function walletMenuItems(sessionWallet: string | null | undefined): WalletMenuItem[] {
  return sessionWallet ? ["copy", "solscan", "sign-out", "disconnect"] : ["copy", "solscan", "disconnect"];
}
