"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";

const rpc =
  process.env.NEXT_PUBLIC_DEFAULT_RPC || "https://api.mainnet-beta.solana.com";

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
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={rpc}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletModalA11y />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
