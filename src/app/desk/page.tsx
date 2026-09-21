"use client";

import { Suspense } from "react";
import { MarketList } from "@/components/MarketList";
import { Panel } from "@/components/Panel";

export default function DeskPage() {
  return (
    <Suspense
      fallback={
        <Panel>
          <div className="skeleton h-4 w-40" />
          <div className="skeleton mt-3 h-64 w-full" />
        </Panel>
      }
    >
      <MarketList />
    </Suspense>
  );
}
