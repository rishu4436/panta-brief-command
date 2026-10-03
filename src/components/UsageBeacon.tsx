"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { setTelemetryWallet, track } from "@/lib/telemetry";

/** One `visit` per page path; keeps the connected wallet available for consented events. */
export function UsageBeacon() {
  const pathname = usePathname();
  const { publicKey, connected } = useWallet();
  const wallet = connected && publicKey ? publicKey.toBase58() : null;

  useEffect(() => {
    setTelemetryWallet(wallet);
  }, [wallet]);

  useEffect(() => {
    track("visit");
  }, [pathname]);

  return null;
}
