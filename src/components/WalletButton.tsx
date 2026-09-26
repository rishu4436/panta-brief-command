"use client";

import { useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useUsdcBalance } from "@/lib/data/hooks";
import { shortAddr } from "@/lib/format";
import { IconChevronDown, IconWallet } from "./ui/Icons";

/** Mainnet USDC mint (balance chip only). */
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/**
 * Wallet state for the desk: disconnected → "Connect Wallet" (opens the
 * wallet-adapter modal); connected → short address with a menu showing
 * network, USDC balance, copy and disconnect. Keys never touch the app.
 */
export function WalletButton({ block = false }: { block?: boolean }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const balance = useUsdcBalance(connection, connected ? publicKey : null, USDC_MINT);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!connected || !publicKey) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        disabled={connecting}
        className={`btn btn-secondary ${block ? "w-full btn-lg" : ""}`}
      >
        <IconWallet className="h-4 w-4 text-cyan-300" />
        {connecting ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  const addr = publicKey.toBase58();
  const usdc =
    balance.data == null
      ? null
      : balance.data.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  return (
    <div ref={ref} className={`relative ${block ? "w-full" : ""}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Wallet ${shortAddr(addr, 4)} connected. Open wallet menu`}
        onClick={() => setOpen((v) => !v)}
        className={`btn btn-secondary ${block ? "w-full justify-between" : ""}`}
      >
        <span className="flex items-center gap-2">
          {wallet?.adapter.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wallet.adapter.icon} alt="" className="h-4 w-4 rounded" />
          ) : (
            <IconWallet className="h-4 w-4" />
          )}
          <span className="font-addr text-[13px]">{shortAddr(addr, 4)}</span>
          <span className="hidden items-center gap-1 rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            Mainnet
          </span>
        </span>
        <IconChevronDown className="h-3.5 w-3.5 text-ink-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-line-strong bg-surface p-2 shadow-2xl animate-fade-in"
        >
          <div className="rounded-lg bg-inset p-3">
            <p className="type-col">Connected wallet</p>
            <p className="font-addr mt-1 break-all text-[12px] text-ink">{addr}</p>
            <dl className="mt-2.5 grid grid-cols-2 gap-2 text-[12px]">
              <div>
                <dt className="text-ink-3">Network</dt>
                <dd className="text-ink">Solana mainnet</dd>
              </div>
              <div>
                <dt className="text-ink-3">USDC</dt>
                <dd className="font-num text-ink">{usdc ?? (balance.isFetching ? "…" : "—")}</dd>
              </div>
            </dl>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(addr);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* ignore */
              }
            }}
            className="mt-1 flex min-h-[40px] w-full items-center rounded-lg px-3 text-left text-[13px] text-ink-2 hover:bg-elevated hover:text-ink"
          >
            {copied ? "Address copied" : "Copy address"}
          </button>
          <a
            role="menuitem"
            href={`https://solscan.io/account/${addr}`}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[40px] w-full items-center rounded-lg px-3 text-[13px] text-ink-2 hover:bg-elevated hover:text-ink"
          >
            View on Solscan
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
            className="flex min-h-[40px] w-full items-center rounded-lg px-3 text-left text-[13px] text-rose-300 hover:bg-rose-400/10"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
