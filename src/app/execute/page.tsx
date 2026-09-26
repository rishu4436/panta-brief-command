"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PrimaryBuyPanel } from "@/components/PrimaryBuyPanel";
import { AttributedTrades } from "@/components/AttributedTrades";
import { Panel } from "@/components/Panel";

function ExecuteInner() {
  const sp = useSearchParams();
  const marketId = sp.get("marketId") || "";
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <p className="eyebrow">Trade</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Execute a primary buy</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
          Get a quote, review fees and the transaction, then approve it in your own wallet. Confirmation on Solana and
          attribution by Panta are shown as separate steps.
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <PrimaryBuyPanel initialMarketId={marketId} />
        {/* Attribution updates invalidate the shared ["accountTrades"] cache. */}
        <AttributedTrades limit={25} kindFilter="buy" compact />
      </div>
    </div>
  );
}

export default function ExecutePage() {
  return (
    <Suspense
      fallback={
        <Panel>
          <div className="skeleton h-4 w-40" />
          <div className="skeleton mt-3 h-64 w-full" />
        </Panel>
      }
    >
      <ExecuteInner />
    </Suspense>
  );
}
