import { Kicker } from "./primitives";
import { PlatformModules } from "./PlatformModules";

const LIMITS = [
  "Secondary-market execution is not supported; buys are primary only.",
  "Market creation is implemented and validated, but not yet proven by a completed creation.",
  "Trading, claims and creation are disabled on read-only preview deployments.",
  "Trading and creator-fee claims are not claimed to be comprehensively tested in production.",
];

/** H. From research to execution: the original desk, reusing its showcases. */
export function PlatformFeature() {
  return (
    <section id="platform" aria-labelledby="platform-title" className="relative scroll-mt-20 border-t border-line/60 py-20 sm:py-28">
      <div className="mx-auto max-w-[1360px] px-5 sm:px-8">
        <div className="lv-reveal grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <div>
            <Kicker index="06">The trading desk</Kicker>
            <h2 id="platform-title" className="lv-h2 mt-5">
              From research <span className="lv-accent text-ink-2">to execution.</span>
            </h2>
          </div>
          <p className="lv-lede max-w-md lg:justify-self-end">
            The desk behind it all: discover markets, read the evidence, buy through your wallet, and follow what happened. Each preview below is
            built from the desk&apos;s own components with sample data.
          </p>
        </div>
        <div className="mt-14">
          <PlatformModules />
        </div>
        <div className="mt-14 rounded-2xl border border-line/70 bg-surface/40 p-5 sm:p-6">
          <h3 className="lv-label !text-[10.5px] text-ink-2">Honest limits</h3>
          <ul className="mt-3 grid gap-x-8 gap-y-2 text-[13px] leading-relaxed text-ink-3 md:grid-cols-2">
            {LIMITS.map((l) => (
              <li key={l} className="flex gap-2.5">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-300/80" aria-hidden="true" />
                {l}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
