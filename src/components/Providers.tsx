"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";
import { makeQueryClient } from "@/lib/data/query-client";
import { resolveRpc } from "@/lib/rpc";

const { endpoint: rpc, isFallback: rpcIsFallback } = resolveRpc();

/** Dev-only hint when the public mainnet RPC fallback is in use. */
function RpcFallbackNote() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && rpcIsFallback) {
      console.info(
        "[rpc] Using the public mainnet RPC fallback. Set NEXT_PUBLIC_DEFAULT_RPC to a dedicated provider (Helius, QuickNode, Triton, Alchemy) for reliable sends and confirmations.",
      );
    }
  }, []);
  return null;
}

/** Wallet adapter close button has no accessible name — patch when modal mounts. */
function WalletModalA11y() {
  useEffect(() => {
    const labelClose = () => {
      document
        .querySelectorAll(".wallet-adapter-modal-button-close")
        .forEach((el) => {
          if (!el.getAttribute("aria-label")) {
            el.setAttribute("aria-label", "Close");
            el.setAttribute("title", "Close");
          }
        });
    };
    labelClose();
    const obs = new MutationObserver(labelClose);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={rpc}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <WalletModalA11y />
            <RpcFallbackNote />
            {children}
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
