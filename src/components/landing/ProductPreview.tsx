import { BrandMark } from "../BrandMark";
import { IconSparkles } from "../ui/Icons";
import { SAMPLE_FLOW, SAMPLE_MARKETS } from "./sample";

function flowPath(values: number[], w: number, h: number) {
  const min = 40;
  const max = 80;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / (max - min)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Hero product preview: a faithful mock of the real desk (market list,
 * selected market with cumulative-flow chart and buy ticket, AI brief).
 * SAMPLE DATA ONLY, labelled as such; the inner UI is hidden from assistive
 * tech so invented numbers are never read as live.
 */
export function ProductPreview({ className = "" }: { className?: string }) {
  const selected = SAMPLE_MARKETS[0];
  const line = flowPath(SAMPLE_FLOW, 300, 92);
  return (
    <figure className={`relative ${className}`}>
      <figcaption className="sr-only">
        Illustrative preview of the Brief Command desk using sample data, not live markets.
      </figcaption>
      <div className="surface-preview relative overflow-hidden p-2.5 sm:p-3" aria-hidden="true">
        {/* App top bar */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-bg/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <BrandMark className="h-4 w-4" />
            <span className="text-[10px] font-bold tracking-[0.08em] text-ink">BRIEF COMMAND</span>
            <span className="ml-3 hidden gap-3 text-[10px] text-ink-3 sm:flex">
              <span className="text-ink">Markets</span>
              <span>Briefs</span>
              <span>Positions</span>
              <span>Activity</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-200">
              Illustrative preview
            </span>
            <span className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-addr text-[9px] text-ink-2 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              7xKq…3fPz
            </span>
          </div>
        </div>

        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[1fr_1.25fr_1fr]">
          {/* Left: market list */}
          <div className="hidden rounded-xl border border-line/70 bg-bg/50 p-2 sm:block">
            <div className="rounded-lg border border-line bg-inset px-2 py-1.5 text-[9px] text-ink-3">Search markets…</div>
            <div className="mt-1.5 flex gap-1">
              {["All", "Crypto", "Finance", "Sports"].map((c, i) => (
                <span key={c} className={`rounded-full px-1.5 py-0.5 text-[8px] ${i === 0 ? "bg-blue-500/20 text-blue-200" : "text-ink-3"}`}>
                  {c}
                </span>
              ))}
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {SAMPLE_MARKETS.map((m, i) => (
                <li
                  key={m.id}
                  className={`rounded-lg border p-1.5 ${i === 0 ? "border-cyan-400/40 bg-cyan-400/[0.06]" : "border-line/70 bg-surface/60"}`}
                >
                  <p className="line-clamp-2 text-[9px] font-medium leading-snug text-ink">{m.title}</p>
                  <div className="mt-1 flex items-center justify-between font-num text-[8px]">
                    <span>
                      <span className="text-emerald-300">{m.yes}% Yes</span>{" "}
                      <span className="text-rose-300">{100 - m.yes}% No</span>
                    </span>
                    <span className="text-ink-3">{m.volume} USDC</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[8px]">
                    <span className="rounded border border-line px-1 text-ink-3">{m.category}</span>
                    <span className={`font-num ${m.flowUp ? "text-emerald-300" : "text-rose-300"}`}>flow {m.flow} pts</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Centre: selected market */}
          <div className="rounded-xl border border-line/70 bg-bg/50 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold leading-snug text-ink">{selected.title}</p>
              <span className="shrink-0 rounded border border-cyan-400/35 bg-cyan-400/10 px-1 text-[8px] text-cyan-200">Open</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-2 py-1.5">
                <p className="text-[8px] font-semibold text-emerald-300">YES</p>
                <p className="font-num text-[20px] font-semibold leading-none text-emerald-200">64%</p>
              </div>
              <div className="rounded-lg border border-rose-400/25 bg-rose-400/[0.06] px-2 py-1.5">
                <p className="text-[8px] font-semibold text-rose-300">NO</p>
                <p className="font-num text-[20px] font-semibold leading-none text-rose-200">36%</p>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[9px] font-medium text-ink-2">Market activity · YES share of flow</p>
              <div className="flex gap-0.5 rounded-md border border-line p-0.5 text-[8px] text-ink-3">
                <span className="rounded px-1">Last 10</span>
                <span className="rounded px-1">Last 25</span>
                <span className="rounded bg-elevated px-1 text-ink">All</span>
              </div>
            </div>
            <svg viewBox="0 0 300 100" className="mt-1 h-[92px] w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="pp-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#12D6F5" stopOpacity="0.28" />
                  <stop offset="1" stopColor="#12D6F5" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" x2="300" y1="46" y2="46" stroke="#2A3B57" strokeDasharray="3 4" />
              <path d={`${line} L300,100 L0,100 Z`} fill="url(#pp-fill)" />
              <path d={line} fill="none" stroke="#12D6F5" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="mt-2 rounded-lg border border-line bg-surface/70 p-2">
              <div className="grid grid-cols-2 gap-1 rounded-md bg-inset p-0.5 text-center text-[9px] font-semibold">
                <span className="rounded bg-emerald-400/15 py-1 text-emerald-200">Buy YES</span>
                <span className="py-1 text-ink-3">Buy NO</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between rounded-md border border-line bg-inset px-2 py-1 font-num text-[9px]">
                <span className="text-ink-3">Amount</span>
                <span className="text-ink">25.00 USDC</span>
              </div>
              <div className="mt-1 flex justify-between font-num text-[8px] text-ink-3">
                <span>Est. shares ~38.4</span>
                <span>Fee 0.25 USDC</span>
              </div>
            </div>
          </div>

          {/* Right: AI brief */}
          <div className="rounded-xl border border-violet-500/25 bg-bg/50 p-2.5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1 text-[10px] font-semibold text-ink">
                <IconSparkles className="h-3 w-3 text-violet-300" /> AI Market Brief
              </p>
              <span className="text-[8px] text-ink-3">Template</span>
            </div>
            <div className="mt-1.5 flex gap-1 text-[8px]">
              {["Summary", "Flow", "Risks", "Watch"].map((t, i) => (
                <span key={t} className={`rounded px-1.5 py-0.5 ${i === 0 ? "bg-violet-500/20 text-violet-200" : "text-ink-3"}`}>
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-ink-2">
              Market prices YES at 64%. Recent flow leans YES (70% of shares over 24 prints), slightly above price.
            </p>
            <p className="mt-2 text-[8px] font-semibold uppercase tracking-wider text-ink-3">Key observations</p>
            <ul className="mt-1 space-y-1 text-[9px] text-ink-2">
              <li className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />Flow share-weighted, 24 prints</li>
              <li className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />Flow 6 pts above market price</li>
              <li className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />Resolves in 41 days</li>
            </ul>
            <p className="mt-2 text-[8px] font-semibold uppercase tracking-wider text-ink-3">Risk notes</p>
            <ul className="mt-1 space-y-1 text-[9px] text-ink-2">
              <li className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />Top wallet is 31% of prints</li>
              <li className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />Primary quote may differ from spot</li>
            </ul>
            <div className="mt-2.5 rounded-lg py-1.5 text-center text-[9px] font-semibold text-white" style={{ background: "var(--grad-cta)" }}>
              Review &amp; Confirm
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-ink-3" aria-hidden="true">
        Illustrative preview · sample data, not live markets
      </p>
    </figure>
  );
}
