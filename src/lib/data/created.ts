"use client";

import { useEffect, useState } from "react";
import { browserCreatedMarkets, needsRegistration, type CreatedMarketRecord } from "@/lib/panta/created-markets";
import { browserRecoveryStore, type CreateRecoveryRecord } from "@/lib/panta/create-recovery";

export type CreateEvidence = {
  /** Registered by Panta (checked receipt), maybe not indexed yet. */
  created: CreatedMarketRecord[];
  /** Confirmed on-chain, registration unfinished (create recovery records). */
  needsAttention: CreateRecoveryRecord[];
  ready: boolean;
};

function readEvidence(): CreateEvidence {
  const needsAttention = browserRecoveryStore
    .wallets()
    .map((w) => browserRecoveryStore.load(w))
    .filter((r): r is CreateRecoveryRecord => needsRegistration(r));
  return { created: browserCreatedMarkets.list(), needsAttention, ready: true };
}

const EMPTY: CreateEvidence = { created: [], needsAttention: [], ready: false };

/** Local create evidence (read after mount; updates on cross-tab storage events). */
export function useCreateEvidence(): CreateEvidence & { reload: () => void } {
  const [ev, setEv] = useState<CreateEvidence>(EMPTY);
  useEffect(() => {
    const load = () => setEv(readEvidence());
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);
  return { ...ev, reload: () => setEv(readEvidence()) };
}
