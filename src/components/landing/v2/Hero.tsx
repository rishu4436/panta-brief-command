import Link from "next/link";
import { IconArrowRight } from "../../ui/Icons";
import { HeroComposition } from "./HeroComposition";

export function Hero({ communityNotice = false }: { communityNotice?: boolean }) {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <div className="lv-grid lv-grid--fade pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(40% 50% at 78% 38%, rgba(52,120,246,0.20), transparent 70%), radial-gradient(26% 34% at 92% 18%, rgba(139,92,246,0.16), transparent 70%), radial-gradient(30% 40% at 12% 20%, rgba(18,214,245,0.07), transparent 70%)",
        }}
      />

      <div className="mx-auto grid max-w-[1360px] gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pt-16 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] xl:items-center xl:gap-10 xl:pb-20 xl:pt-16">
        <div className="rise-in min-w-0">
          <p className="lv-mono inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
            <span className="sm:hidden">Markets · forecasts · community</span>
            <span className="hidden sm:inline">Prediction markets · forecasting · community</span>
          </p>
          <h1 id="hero-title" className="lv-h1 mt-7 xl:text-[clamp(3.6rem,1rem+3.6vw,5.1rem)]">
            <span className="block">Read the market.</span>
            <span className="block">
              Test your <span className="lv-accent text-gradient-flow">thesis.</span>
            </span>
            <span className="block text-ink-2">Bring others in.</span>
          </h1>
          <p className="lv-lede mt-7 max-w-[540px]">
            Discover live prediction markets, make free community forecasts, challenge ideas with evidence, and trade through your own Solana
            wallet—all in one workspace.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/desk" className="btn btn-primary btn-lg group">
              Explore Markets
              <IconArrowRight className="icon-nudge h-4 w-4" />
            </Link>
            <Link href="/rooms" className="btn btn-secondary btn-lg">
              Explore Prediction Rooms
            </Link>
          </div>
          <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
              Forecast for free.
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />
              Trade only when you choose.
            </span>
          </p>
          {communityNotice ? (
            <p role="note" data-testid="landing-community-notice" className="mt-5 max-w-[540px] rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12.5px] leading-relaxed text-amber-100/90">
              This read-only preview has no community storage: Rooms, forecasts, the Arena and Creator Studio are unavailable here. Markets and
              research still work.
            </p>
          ) : null}
        </div>

        <div className="rise-in rise-delay-1 relative min-w-0">
          <HeroComposition />
        </div>
      </div>
    </section>
  );
}
