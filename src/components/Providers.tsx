"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { UsageBeacon } from "./UsageBeacon";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@/styles/wallet-adapter-ui.css";
import { makeQueryClient } from "@/lib/data/query-client";
import { clientRpcEndpoint } from "@/lib/rpc";

/**
 * Every browser RPC call goes through the same-origin relay; the provider URL
 * (and its key) stays on the server. The server render never uses the
 * Connection, so a placeholder origin is fine there.
 */
const rpc = clientRpcEndpoint(typeof window !== "undefined" ? window.location.origin : "http://localhost");

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
            <UsageBeacon />
            {children}
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
