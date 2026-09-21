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
        <h1 className="text-lg font-semibold tracking-tight text-zinc-50">
          Execute
        </h1>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Primary buy · guided Quote → Attribute · live attribution ledger
        </p>
      </div>
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
