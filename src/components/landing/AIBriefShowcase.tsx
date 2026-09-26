"use client";

import { useId, useState } from "react";
import { BriefRow } from "../AiBrief";
import { EVIDENCE, EvidenceTag, type EvidenceLayer } from "../brief/EvidenceTag";
import { IconSparkles } from "../ui/Icons";
import { SAMPLE_BRIEF, SAMPLE_NARRATIVE, SAMPLE_RESOLVES_LABEL, SAMPLE_SIGNALS as S } from "./sample";

const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const hours = (m: number) => `${(m / 60).toFixed(1)}h`;

/** Every figure below is computed by the real signals engine from the sample tape. */
type Line = { label: string; layer: EvidenceLayer; text: string };
const TABS: { id: string; label: string; rows: Line[] }[] = [
  {
    id: "summary",
    label: "Summary",
    rows: [
      { label: "Snapshot", layer: "observed", text: `Market prices YES at ${pct(S.probability.yes)} (live spot). Last print ${S.tape.lastPrintAgeMinutes}m ago.` },
      { label: "Signal", layer: "derived", text: S.headline },
      { label: "Not in data", layer: "unknown", text: S.probabilityChange.reason ?? "Price change across the window." },
    ],
  },
  {
    id: "flow",
    label: "Flow",
    rows: [
      { label: "Tape", layer: "observed", text: `${S.tape.count} prints over ${hours(S.tape.windowMinutes ?? 0)}: ${S.tape.yesPrints} YES / ${S.tape.noPrints} NO.` },
      { label: "Flow", layer: "derived", text: `Share-weighted YES ${pct(S.flow.yesFlowShare, 1)} · imbalance +${S.flow.imbalance?.toFixed(2)}.` },
      { label: "Vs price", layer: "derived", text: `Flow is ${S.divergence.gapPts} pts above the market's YES probability.` },
      { label: "Not in data", layer: "unknown", text: "Who the buyers are and why they bought." },
    ],
  },
  {
    id: "risks",
    label: "Risks",
    rows: [
      { label: "Risk", layer: "derived", text: S.riskFlags.map((f) => f.label).join(" · ") || "No deterministic risk flags raised." },
      { label: "Quality", layer: "derived", text: `${S.dataQuality.grade.toUpperCase()}: ${S.dataQuality.reasons.join(" · ")}.` },
      { label: "Wallets", layer: "derived", text: `Largest wallet accounts for ${pct(S.tape.topWalletPrintShare)} of prints.` },
      { label: "Not in data", layer: "unknown", text: "Order-book depth and off-chain news." },
    ],
  },
  {
    id: "watch",
    label: "What to watch",
    rows: [
      { label: "Resolution", layer: "observed", text: `Resolves ${SAMPLE_RESOLVES_LABEL}. ${SAMPLE_BRIEF.market.resolutionRule}` },
      { label: "Execution", layer: "observed", text: S.execution.lines[1] ?? "" },
      { label: "Not in data", layer: "unknown", text: "Scheduled real-world catalysts." },
    ],
  },
];

/** The template's Observation paragraph (exact output, pinned by a test). */
const INTERPRETATION = (SAMPLE_NARRATIVE.match(/### Observation\n([\s\S]*?)\n\n###/)?.[1] ?? "").trim();

export function AIBriefShowcase() {
  const [tab, setTab] = useState(TABS[0].id);
  const base = useId();
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <section id="ai-brief" className="relative scroll-mt-20 overflow-hidden py-14 sm:py-16" aria-labelledby="ai-title">
      <div className="glow-soft pointer-events-none absolute left-0 top-1/4 -z-10 h-[480px] w-[640px]" aria-hidden="true" />
      <div className="mx-auto grid max-w-[1320px] gap-10 px-5 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-x-14 lg:gap-y-6">
        {/* Right on desktop: the reading guide (header, then label definitions) */}
        <div className="lg:col-start-2 lg:row-start-1 lg:self-end">
          <p className="eyebrow eyebrow--ai">AI market brief</p>
          <h2 id="ai-title" className="h-section mt-3">
            Evidence first. Interpretation second.
          </h2>
          <p className="text-lede mt-3">
            Each brief starts with what the data shows, computed the same way every time, and only then adds a written reading of it. Every line says which kind it is.
          </p>
        </div>

        {/* Left on desktop: the brief itself */}
        <figure className="card-elevated relative overflow-hidden lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "var(--grad-ai)" }} aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <IconSparkles className="h-4 w-4 text-violet-300" /> AI Market Brief
            </p>
            <span className="rounded-md border border-amber-400/50 bg-amber-400/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
              Illustrative preview · sample market
            </span>
          </div>

          <div className="p-4">
            <div role="tablist" aria-label="Brief sections" className="segmented flex w-full">
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
                  className="min-h-11 flex-1 whitespace-nowrap px-1.5 sm:min-h-[30px]"
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active.id}`} className="mt-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">1 · Evidence</p>
              <div className="divide-y divide-line rounded-xl border border-line bg-inset">
                {active.rows.map((r) => (
                  <BriefRow key={r.label} label={r.label} layer={r.layer}>
                    <p className="type-body">{r.text}</p>
                  </BriefRow>
                ))}
              </div>
            </div>

            <p className="mb-1.5 mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              2 · Interpretation
              <span className="rounded border border-violet-500/40 px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal text-violet-200">
                Template · AI unavailable
              </span>
            </p>
            <div className="rounded-xl border border-violet-500/20 bg-inset p-3">
              <div className="mb-1.5">
                <EvidenceTag layer="interpretation" />
              </div>
              <p className="type-body">{INTERPRETATION}</p>
            </div>
            <figcaption className="mt-3 text-[12px] text-ink-3">
              Sample market and tape, run through the real signals engine and brief template. Not a forecast or advice.
            </figcaption>
          </div>
        </figure>
        <dl className="space-y-3 lg:col-start-2 lg:row-start-2 lg:self-start">
            {(Object.keys(EVIDENCE) as EvidenceLayer[]).map((l) => (
              <div key={l} className="grid grid-cols-[112px_1fr] items-baseline gap-3">
                <dt>
                  <EvidenceTag layer={l} className="!text-[10px] !px-1.5 !py-0.5" />
                </dt>
                <dd className="text-[14px] leading-relaxed text-ink-2">{EVIDENCE[l].hint}.</dd>
              </div>
            ))}
        </dl>
      </div>
    </section>
  );
}
