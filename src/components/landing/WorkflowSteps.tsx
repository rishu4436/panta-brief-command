import type { ReactNode } from "react";
import { SectionHeader } from "../ui/SectionHeader";
import { IconArrowRight, IconBolt, IconPortfolio, IconRadar, IconSparkles } from "../ui/Icons";

function MiniList() {
  const rows = [
    { t: "Market A", y: "62%", on: true },
    { t: "Market B", y: "41%", on: false },
    { t: "Market C", y: "55%", on: false },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div
          key={r.t}
          className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px] ${r.on ? "border-cyan-400/40 bg-cyan-400/[0.07] text-ink" : "border-line bg-bg/60 text-ink-3"}`}
        >
          <span>{r.t}</span>
          <span className="font-num">{r.y} YES</span>
        </div>
      ))}
    </div>
  );
}

function MiniBrief() {
  const rows = [
    { tag: "Observed", c: "text-cyan-300 border-cyan-400/30", t: "12 prints in window" },
    { tag: "Derived", c: "text-blue-300 border-blue-400/30", t: "Flow 58% YES" },
    { tag: "AI", c: "text-violet-300 border-violet-400/30", t: "Flow leans above price" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.tag} className="flex items-center gap-2 rounded-md border border-line bg-bg/60 px-2.5 py-1.5 text-[11px] text-ink-2">
          <span className={`rounded border px-1 text-[9px] font-semibold uppercase ${r.c}`}>{r.tag}</span>
          <span className="truncate">{r.t}</span>
        </div>
      ))}
    </div>
  );
}

function MiniTrade() {
  return (
    <div className="rounded-md border border-line bg-bg/60 p-2.5 text-[11px]">
      <div className="flex justify-between text-ink-3">
        <span>Quote</span>
        <span className="font-num text-ink">10.00 USDC → ~15.6 YES</span>
      </div>
      <div className="mt-1 flex justify-between text-ink-3">
        <span>Fee</span>
        <span className="font-num text-ink-2">shown before signing</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        <span className="h-1 rounded-full bg-emerald-400/80" />
        <span className="h-1 rounded-full bg-cyan-400" />
        <span className="h-1 rounded-full bg-line" />
      </div>
    </div>
  );
}

function MiniBook() {
  return (
    <div className="rounded-md border border-line bg-bg/60 text-[11px]">
      {[
        { m: "Market A · YES", s: "Confirmed", c: "text-emerald-300" },
        { m: "Market C · NO", s: "Claimable", c: "text-cyan-300" },
      ].map((r, i) => (
        <div key={r.m} className={`flex justify-between px-2.5 py-1.5 ${i ? "border-t border-line" : ""}`}>
          <span className="text-ink-2">{r.m}</span>
          <span className={r.c}>{r.s}</span>
        </div>
      ))}
    </div>
  );
}

const STEPS: { n: string; tag: string; title: string; body: string; Icon: (p: { className?: string }) => ReactNode; tone: string; visual: ReactNode }[] = [
  {
    n: "01",
    tag: "Intel",
    title: "Discover the markets.",
    // Adjusted from the brief's copy: the desk filters by category/phase and sorts by volume or end date (no "trend" filter).
    body: "Browse Panta markets, filter by category and phase, and sort by volume or end date. Find the markets you want to investigate.",
    Icon: IconRadar,
    tone: "text-cyan-300",
    visual: <MiniList />,
  },
  {
    n: "02",
    tag: "Brief",
    title: "Understand the flow.",
    body: "Analyze probability, volume, and recent trades to build a concise market brief with observations and risks.",
    Icon: IconSparkles,
    tone: "text-violet-300",
    visual: <MiniBrief />,
  },
  {
    n: "03",
    tag: "Execute",
    title: "Review and execute.",
    body: "Get a real-time quote, review fees, and approve the transaction with your connected Solana wallet.",
    Icon: IconBolt,
    tone: "text-blue-300",
    visual: <MiniTrade />,
  },
  {
    n: "04",
    tag: "Book",
    title: "Track your activity.",
    body: "View positions, claims, transaction history, and attribution in one place.",
    Icon: IconPortfolio,
    tone: "text-emerald-300",
    visual: <MiniBook />,
  },
];

export function WorkflowSteps() {
  return (
    <section id="how-it-works" className="scroll-mt-20 py-20 sm:py-24" aria-labelledby="how-title">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <SectionHeader
          eyebrow="How it works"
          id="how-title"
          title="From market data to execution—in 4 steps."
          description="We bring together live Panta markets, AI analysis, and Solana execution so you can manage your workflow in one place."
          align="center"
        />
        <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {STEPS.map(({ n, tag, title, body, Icon, tone, visual }, i) => (
            <li key={n} className="relative">
              <div className="card card-hover group flex h-full flex-col p-5">
                <div className="flex items-center justify-between">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-bg ${tone}`}>
                    <span className="icon-nudge inline-flex">
                      <Icon className="h-5 w-5" />
                    </span>
                  </span>
                  <span className="font-num text-[12px] font-semibold tracking-wider text-ink-3">
                    {n} · {tag.toUpperCase()}
                  </span>
                </div>
                <h3 className="h-card mt-5">{title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-3">{body}</p>
                <div className="mt-auto pt-5" aria-hidden="true">
                  {visual}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-[26px] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-bg text-ink-3 lg:flex"
                >
                  <IconArrowRight className="h-3.5 w-3.5" />
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
