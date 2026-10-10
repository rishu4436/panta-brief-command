import { Kicker } from "./primitives";

const STEPS = [
  ["Discover", "Find a live market."],
  ["Research", "Read price, flow and evidence."],
  ["Forecast", "Share a free probability."],
  ["Debate", "Test both sides' evidence."],
  ["Participate", "Follow it to resolution."],
] as const;

/** I. The journey, with trading as an optional parallel path. */
export function Journey() {
  return (
    <section aria-labelledby="journey-title" className="relative border-t border-line/60 py-12 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-[1360px] px-5 sm:px-8">
        <div className="lv-reveal flex flex-wrap items-end justify-between gap-4">
          <div>
            <Kicker index="07">The journey</Kicker>
            <h2 id="journey-title" className="lv-h2 mt-4 sm:mt-5 !text-[clamp(1.8rem,1.1rem+2vw,2.75rem)]">
              Curiosity in. <span className="lv-accent text-ink-2">Clarity out.</span>
            </h2>
          </div>
          <p className="max-w-sm text-[14px] leading-relaxed text-ink-3">Every step is free. Trading is a separate, optional path you can take at any point after research.</p>
        </div>

        <div className="lv-reveal relative mt-7 sm:mt-12">
          <ol className="relative grid gap-3.5 sm:gap-6 md:grid-cols-5 md:gap-4">
            <span aria-hidden="true" className="absolute bottom-4 left-[15px] top-4 w-px bg-gradient-to-b from-cyan-400/60 via-emerald-400/40 to-violet-400/50 md:bottom-auto md:left-4 md:right-4 md:top-[15px] md:h-px md:w-auto md:bg-gradient-to-r" />
            {STEPS.map(([t, d], i) => (
              <li key={t} className="relative grid grid-cols-[32px_1fr] items-center gap-4 md:block">
                <span className="lv-mono relative z-10 flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-bg text-[11px] text-cyan-200">{i + 1}</span>
                <div className="md:mt-4">
                  <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink sm:text-[16px]">
                    {t}
                    <span className="ml-2 text-[13px] font-normal tracking-normal text-ink-3 sm:ml-0 sm:mt-0.5 sm:block sm:text-[13.5px]">{d}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {/* Optional parallel path: branches after Research, rejoins at Participate */}
          <div className="mt-5 grid sm:mt-8 md:grid-cols-5 md:gap-4">
            <div className="relative rounded-xl border border-dashed border-blue-400/35 bg-blue-500/[0.04] px-4 py-3 md:col-span-4 md:col-start-2">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="lv-mono text-[11px] uppercase tracking-[0.14em] text-blue-300">Optional · Trade</span>
                <span className="text-ink-2">Quote, review and approve a primary buy in your own wallet. Real funds, separate from forecasts.</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
