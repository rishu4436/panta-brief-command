"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PrimaryBuyPanel } from "@/components/PrimaryBuyPanel";
import { GlassCard } from "@/components/GlassCard";

function ExecuteInner() {
  const sp = useSearchParams();
  const marketId = sp.get("marketId") || "";
  return (
    <div className="space-y-4">
      <GlassCard title="Execute">
        <h1 className="text-2xl font-semibold text-zinc-50">Primary buy desk</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Full Panta primary path using{" "}
          <code className="text-cyan-300/80">@solana/web3.js</code> + wallet
          adapter. Instructions + blockhash compile to a versioned transaction
          client-side; the API key never leaves the server proxy.
        </p>
      </GlassCard>
      <PrimaryBuyPanel initialMarketId={marketId} />
    </div>
  );
}

export default function ExecutePage() {
  return (
    <Suspense
      fallback={
        <GlassCard>
          <p className="text-sm text-zinc-400">Loading execute desk…</p>
        </GlassCard>
      }
    >
      <ExecuteInner />
    </Suspense>
  );
}
