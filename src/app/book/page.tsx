"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookPanel } from "@/components/BookPanel";
import { AttributedTrades } from "@/components/AttributedTrades";
import { SkeletonLoader } from "@/components/ui/States";

/**
 * Book desk (Phase 1 — Position Intelligence):
 * PORTFOLIO → EXPOSURE → POSITIONS → ACTIVITY → CLAIMS
 * ?tab=positions|claims|activity scrolls to the section.
 */

type Section = "positions" | "claims" | "activity";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "positions", label: "Portfolio" },
  { id: "activity", label: "Activity" },
  { id: "claims", label: "Claims" },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function BookInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const raw = sp.get("tab");

  useEffect(() => {
    if (raw === "claims") scrollTo("claims");
    else if (raw === "activity") scrollTo("activity");
    else if (raw === "positions") scrollTo("portfolio");
  }, [raw]);

  const go = (t: Section) => {
    router.replace(`/book?tab=${t}`, { scroll: false });
    requestAnimationFrame(() => {
      if (t === "claims") scrollTo("claims");
      else if (t === "activity") scrollTo("activity");
      else scrollTo("portfolio");
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <p className="eyebrow">Your book</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Position intelligence</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
          Marked holdings, claim readiness and attributed activity for the connected wallet. Mark value is current
          marked notional — not profit and loss.
        </p>
      </div>

      {/* Full-bleed opaque sticky strip so content scrolls cleanly beneath it. */}
      <div className="sticky top-16 z-20 -mx-4 border-b border-line bg-bg px-4 py-2.5 sm:-mx-6 sm:px-6">
        <nav aria-label="Book sections" className="segmented w-fit">
          {SECTIONS.map((t) => (
            <a
              key={t.id}
              href={`/book?tab=${t.id}`}
              aria-current={raw === t.id || (!raw && t.id === "positions") ? "page" : undefined}
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
      </div>

      {/* One BookPanel instance so claim ticket state is shared with the positions table. */}
      <BookPanel
        layout="desk"
        onTabChange={(t) => go(t)}
        activitySlot={
          <section id="activity" className="scroll-mt-36">
            <AttributedTrades limit={50} />
          </section>
        }
      />
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
