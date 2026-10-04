/**
 * WalletProvider onError (src/components/Providers.tsx).
 *
 * The wallet adapter's default handler console.errors every adapter error,
 * including the user declining in the wallet, which the ticket already shows
 * as the "Signature rejected" state. This handler keeps that one case quiet
 * and logs everything else exactly as before (connection failures, autoConnect
 * failures, WalletNotReady, unknown errors). It also keeps the default's
 * WalletNotReady behaviour of opening the wallet's install page.
 *
 * Only logging changes: the adapter still rejects the sign/connect promise,
 * and the ticket's own catch handles it as before.
 */
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { isUserRejection } from "./trade-state";

export type WalletErrorDeps = {
  log?: (...args: unknown[]) => void;
  open?: (url: string) => void;
};

export function walletErrorLevel(error: unknown): "silent" | "error" {
  return isUserRejection(error) ? "silent" : "error";
}

export function handleWalletError(error: WalletError, adapter?: Adapter, deps: WalletErrorDeps = {}): void {
  if (walletErrorLevel(error) === "silent") return;
  const log = deps.log ?? ((...a: unknown[]) => console.error(...a));
  log(error, adapter);
  if ((error as { name?: unknown })?.name === "WalletNotReadyError" && adapter?.url) {
    const open = deps.open ?? ((url: string) => (typeof window !== "undefined" ? void window.open(url, "_blank") : undefined));
    open(adapter.url);
  }
}

/** Stable reference for <WalletProvider onError>. */
export function onWalletError(error: WalletError, adapter?: Adapter): void {
  handleWalletError(error, adapter);
}
