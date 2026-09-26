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
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="type-page">Execute</h1>
        <p className="type-lede">
          Guided primary buy · quote through attribute · live activity
        </p>
      </div>
      {/* Attribution updates invalidate the shared ["accountTrades"] cache. */}
      <PrimaryBuyPanel initialMarketId={marketId} />
      <AttributedTrades limit={25} kindFilter="buy" compact />
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
