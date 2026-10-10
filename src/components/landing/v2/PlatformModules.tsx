"use client";

import dynamic from "next/dynamic";
import { useId, useState, type ReactNode } from "react";
import { IconCheck } from "../../ui/Icons";
import { Illustrative } from "./primitives";

/* The heavy previews are the desk's own components; each loads in its own
   chunk, and only the selected one renders. Fixed-ratio placeholders keep
   the layout stable while a chunk loads. */
const Placeholder = ({ ratio = "1280 / 900" }: { ratio?: string }) => <div className="skeleton w-full rounded-2xl" style={{ aspectRatio: ratio }} aria-hidden="true" />;
const ProductPreview = dynamic(() => import("../ProductPreview").then((m) => m.ProductPreview), { loading: () => <Placeholder /> });
const AIBriefFigure = dynamic(() => import("../AIBriefShowcase").then((m) => m.AIBriefFigure), { loading: () => <Placeholder ratio="4 / 3" /> });
const ExecutionStage = dynamic(() => import("../ExecutionShowcase").then((m) => m.ExecutionStage), { loading: () => <Placeholder ratio="4 / 3" /> });
const PortfolioTables = dynamic(() => import("../PortfolioShowcase").then((m) => m.PortfolioTables), { loading: () => <Placeholder ratio="16 / 7" /> });

function CreationMock() {
  const rows: [string, string][] = [
    ["Question", "Will the event happen before the stated date?"],
    ["Resolution criteria", "Resolves YES only if the stated source confirms it by the deadline."],
    ["Source of truth", "One named, public source"],
    ["Dates", "Trading end · resolution time"],
  ];
  return (
    <figure>
      <figcaption className="sr-only">Illustrative market-creation form with placeholder values.</figcaption>
      <div aria-hidden="true" inert className="lv-panel overflow-hidden">
        <div className="lv-panel-head">
          <span className="lv-label">Create market · definition</span>
          <Illustrative />
        </div>
        <dl className="divide-y divide-line/60">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[150px_1fr] sm:gap-4">
              <dt className="lv-label !text-[9.5px] pt-0.5">{k}</dt>
              <dd className="text-[13px] text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-3 border-t border-line/70 bg-inset/50 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="space-y-1.5 text-[12px] text-ink-3">
            <p className="flex items-center gap-2">
              <IconCheck className="h-3.5 w-3.5 text-emerald-300" /> Quote and creation fee shown before signing
            </p>
            <p className="flex items-center gap-2">
              <IconCheck className="h-3.5 w-3.5 text-emerald-300" /> Transaction validated before your wallet is asked
            </p>
          </div>
          <span className="rounded-[10px] border border-line-strong px-4 py-2 text-center text-[12px] font-semibold text-ink-2">Review &amp; sign</span>
        </div>
      </div>
    </figure>
  );
}

type Module = { id: string; title: string; short: string; points: string[]; limit?: string; visual: () => ReactNode };

const MODULES: Module[] = [
  {
    id: "discovery",
    title: "Market discovery",
    short: "The live Panta catalog",
    points: ["Live Panta catalog with categories", "Primary, secondary and resolved lifecycle", "Prices, volume and recent activity"],
    visual: () => <ProductPreview />,
  },
  {
    id: "brief",
    title: "AI Market Brief",
    short: "Deterministic signals first",
    points: ["Deterministic signal analysis", "Evidence labels on every line", "Data-quality and risk flags", "Optional model interpretation, labelled as such"],
    limit: "Without an AI provider the brief uses the deterministic template and writes no interpretation.",
    visual: () => <AIBriefFigure />,
  },
  {
    id: "execution",
    title: "Wallet execution",
    short: "Primary YES / NO buys",
    points: ["Primary YES / NO buying", "Quote, average price and fee review", "Pre-sign validation, then wallet signing", "Confirmation and attribution tracked separately"],
    limit: "Secondary-market execution isn't supported. Execution is disabled on read-only previews.",
    visual: () => <ExecutionStage />,
  },
  {
    id: "portfolio",
    title: "Portfolio & claims",
    short: "Positions, settlement, claims",
    points: ["Positions and activity from your wallet", "Settlement and claim eligibility", "Verified vs pending, never blurred"],
    visual: () => <PortfolioTables />,
  },
  {
    id: "creation",
    title: "Market creation",
    short: "Defined, sourced, validated",
    points: ["Market definition and resolution criteria", "Named sources of truth", "Quote and fee transparency", "Validated transaction workflow"],
    limit: "The creation flow is built and validated, but a completed on-chain creation hasn't been demonstrated yet.",
    visual: () => <CreationMock />,
  },
];

/** H. Interactive module index: pick a capability, see the real component. */
export function PlatformModules() {
  const [active, setActive] = useState(MODULES[0].id);
  const base = useId();
  const m = MODULES.find((x) => x.id === active) ?? MODULES[0];
  const focusTab = (id: string) => document.getElementById(`${base}-tab-${id}`)?.focus();

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-12">
      <div
        role="tablist"
        aria-label="Platform modules"
        aria-orientation="vertical"
        className="flex flex-wrap gap-2 lg:flex-col lg:gap-0 lg:border-l lg:border-line/70"
        onKeyDown={(e) => {
          const keys = ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"];
          if (!keys.includes(e.key)) return;
          e.preventDefault();
          const i = MODULES.findIndex((x) => x.id === active);
          const n = MODULES.length;
          const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % n : (i - 1 + n) % n;
          setActive(MODULES[next].id);
          focusTab(MODULES[next].id);
        }}
      >
        {MODULES.map((x, i) => {
          const on = x.id === active;
          return (
            <button
              key={x.id}
              id={`${base}-tab-${x.id}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`${base}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(x.id)}
              className={`group relative min-h-11 rounded-full border px-3.5 text-left text-[13px] font-medium transition-colors lg:-ml-px lg:rounded-none lg:border-0 lg:border-l-2 lg:px-5 lg:py-4 ${
                on ? "border-cyan-400/50 bg-cyan-400/[0.08] text-ink lg:border-cyan-300 lg:bg-transparent" : "border-line text-ink-2 hover:text-ink lg:border-transparent"
              }`}
            >
              <span className="lv-mono mr-2 hidden text-[11px] text-ink-3 lg:inline">0{i + 1}</span>
              <span className="lg:text-[16px] lg:font-semibold lg:tracking-[-0.01em]">{x.title}</span>
              <span className={`mt-0.5 hidden text-[13px] font-normal lg:block ${on ? "text-ink-2" : "text-ink-3"}`}>{x.short}</span>
            </button>
          );
        })}
      </div>

      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${m.id}`} className="min-w-0" tabIndex={0}>
        <div key={m.id} className="animate-fade-in">
          {m.visual()}
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <ul className="space-y-2">
            {m.points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[14px] text-ink-2">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                {p}
              </li>
            ))}
          </ul>
          {m.limit ? (
            <p className="self-start rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-3.5 text-[13px] leading-relaxed text-amber-100/90">
              <span className="lv-label mb-1 block !text-amber-200/80">Limit</span>
              {m.limit}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
