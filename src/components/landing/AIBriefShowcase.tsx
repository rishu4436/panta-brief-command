"use client";

import { useId, useState } from "react";
import { SectionHeader } from "../ui/SectionHeader";
import { IconCheck, IconSparkles } from "../ui/Icons";

type Layer = "observed" | "derived" | "ai" | "unknown";
const LAYER: Record<Layer, { label: string; cls: string }> = {
  observed: { label: "Observed", cls: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200" },
  derived: { label: "Derived", cls: "border-blue-500/40 bg-blue-500/10 text-blue-200" },
  ai: { label: "AI interpretation", cls: "border-violet-500/40 bg-violet-500/10 text-violet-200" },
  unknown: { label: "Unknown", cls: "border-amber-400/40 bg-amber-400/10 text-amber-200" },
};

type Row = { layer: Layer; text: string };
const TABS: { id: string; label: string; rows: Row[] }[] = [
  {
    id: "summary",
    label: "Summary",
    rows: [
      { layer: "observed", text: "Market prices YES at 64% (spot). Last print 12 minutes ago." },
      { layer: "derived", text: "YES share of recent flow is 70%, 6 pts above the market price." },
      { layer: "ai", text: "Potential interpretation: recent buyers lean YES more than the price implies. This is activity, not a forecast." },
      { layer: "unknown", text: "Who the buyers are and why they bought is not visible in the data." },
    ],
  },
  {
    id: "flow",
    label: "Flow",
    rows: [
      { layer: "observed", text: "24 prints in the window: 17 YES, 7 NO." },
      { layer: "derived", text: "Flow is share-weighted: 70% YES, imbalance +0.40." },
      { layer: "observed", text: "Recent volume 312 USDC across the window." },
      { layer: "unknown", text: "Secondary-market depth is not reported by this feed." },
    ],
  },
  {
    id: "risks",
    label: "Risks",
    rows: [
      { layer: "derived", text: "Concentration: one wallet accounts for 31% of prints." },
      { layer: "observed", text: "Low activity: fewer than 30 prints, so signals are noisy." },
      { layer: "ai", text: "Relevant uncertainty: resolution depends on the oracle's reading of the rule text." },
      { layer: "unknown", text: "No external news or order-book data is used." },
    ],
  },
  {
    id: "watch",
    label: "What to watch",
    rows: [
      { layer: "observed", text: "Market resolves in 41 days (end time from Panta)." },
      { layer: "derived", text: "Watch whether flow share converges back toward the price." },
      { layer: "ai", text: "A shift in the top wallet's activity would change the flow signal most." },
      { layer: "unknown", text: "Scheduled real-world catalysts are not in the data feed." },
    ],
  },
];

const CAPABILITIES = [
  "Market snapshot with YES/NO probability and data timestamp",
  "Flow from recent prints, share-weighted when sizes exist",
  "Risk flags: stale data, low activity, wallet concentration",
  "Every line tagged as observed, derived, interpreted, or unknown",
  "Deterministic template fallback when the AI service is unavailable",
];

export function AIBriefShowcase() {
  const [tab, setTab] = useState(TABS[0].id);
  const base = useId();
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <section className="relative overflow-hidden py-20 sm:py-24" aria-labelledby="ai-title">
      <div className="glow-soft pointer-events-none absolute right-0 top-1/3 -z-10 h-[480px] w-[640px]" aria-hidden="true" />
      <div className="mx-auto grid max-w-[1320px] gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
        <div>
          <SectionHeader
            eyebrow="AI market intelligence"
            tone="ai"
            id="ai-title"
            title="More context behind every probability."
            description="Turn market data and trading activity into a structured brief that helps users understand what changed, what the evidence shows, and what remains uncertain."
          />
          <ul className="mt-8 space-y-3">
            {CAPABILITIES.map((c) => (
              <li key={c} className="flex gap-3 text-[15px] text-ink-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-200">
                  <IconCheck className="h-3 w-3" />
                </span>
                {c}
              </li>
            ))}
          </ul>
        </div>

        <div className="card-elevated relative overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "var(--grad-ai)" }} aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[17px] font-semibold text-ink">
              <IconSparkles className="h-5 w-5 text-violet-300" /> AI Market Brief
            </p>
            <span className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
              Illustrative example
            </span>
          </div>

          <div role="tablist" aria-label="Brief sections" className="segmented mt-5 flex w-full overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                id={`${base}-tab-${t.id}`}
                aria-controls={`${base}-panel`}
                aria-selected={tab === t.id}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const i = TABS.findIndex((x) => x.id === tab);
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                    setTab(next.id);
                    document.getElementById(`${base}-tab-${next.id}`)?.focus();
                  }
                }}
                className="flex-1 whitespace-nowrap"
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              ["Market YES", "64%"],
              ["Flow YES", "70%"],
              ["Data quality", "Medium"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-inset px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{k}</p>
                <p className="font-num mt-0.5 text-[18px] font-semibold text-ink">{v}</p>
              </div>
            ))}
          </div>

          <ul id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active.id}`} className="mt-5 space-y-2.5">
            {active.rows.map((r, i) => (
              <li key={i} className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg/50 p-3 sm:flex-row sm:items-start sm:gap-3">
                <span className={`inline-flex w-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider sm:w-32 sm:justify-center ${LAYER[r.layer].cls}`}>
                  {LAYER[r.layer].label}
                </span>
                <span className="text-[14px] leading-relaxed text-ink-2">{r.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-[12px] text-ink-3">
            Sample content showing the brief&apos;s structure. Data timestamp and source (LLM or template) are shown on
            every live brief. Not a forecast or financial advice.
          </p>
        </div>
      </div>
    </section>
  );
}
