"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BookPanel, type BookTab } from "@/components/BookPanel";
import { AttributedTrades } from "@/components/AttributedTrades";
import { SkeletonLoader } from "@/components/ui/States";

type Tab = BookTab | "activity";
const TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "claims", label: "Claims" },
  { id: "activity", label: "Activity" },
];

function BookInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const raw = sp.get("tab");
  const tab: Tab = raw === "claims" || raw === "activity" ? raw : "positions";
  const go = (t: Tab) => router.replace(`/book?tab=${t}`, { scroll: false });

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <p className="eyebrow">Your book</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Everything after the trade</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          Positions, claims and attributed activity for the connected wallet. Transaction confirmation (Solana) and
          attribution (Panta) are tracked separately.
        </p>
      </div>
      <nav aria-label="Book sections" className="segmented">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`/book?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(t.id);
            }}
            className="inline-flex items-center"
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab === "activity" ? (
        /* Attribution updates invalidate the shared ["accountTrades"] cache. */
        <AttributedTrades limit={50} />
      ) : (
        <BookPanel tab={tab} onTabChange={go} />
      )}
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={<SkeletonLoader rows={5} label="Loading book" />}>
      <BookInner />
    </Suspense>
  );
}
