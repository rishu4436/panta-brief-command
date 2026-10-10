import Link from "next/link";
import { IconArrowRight } from "../../ui/Icons";

/** J. Final call to action. */
export function FinalCall() {
  return (
    <section aria-labelledby="final-title" className="relative isolate overflow-hidden border-t border-line/60 py-16 sm:py-24 lg:py-32">
      <div className="lv-grid lv-grid--fade pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{ background: "radial-gradient(45% 60% at 50% 100%, rgba(52,120,246,0.22), transparent 70%), radial-gradient(30% 40% at 70% 90%, rgba(139,92,246,0.16), transparent 70%)" }}
      />
      <div className="lv-reveal mx-auto max-w-[1100px] px-5 text-center sm:px-8">
        <h2 id="final-title" className="lv-h2 !text-[clamp(2.3rem,1.1rem+4vw,4.6rem)]">
          Turn market curiosity into <span className="lv-accent text-gradient-flow">collective intelligence.</span>
        </h2>
        <p className="lv-lede mx-auto mt-4 sm:mt-6 max-w-xl">Explore markets, share forecasts, challenge evidence and follow the outcome.</p>
        <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link href="/desk" className="btn btn-primary btn-lg group">
            Explore Markets <IconArrowRight className="icon-nudge h-4 w-4" />
          </Link>
          <Link href="/rooms" className="btn btn-secondary btn-lg">
            Explore Rooms
          </Link>
        </div>
        <p className="mt-6 text-[14px] text-ink-3">
          Running a community?{" "}
          <Link href="/studio" className="font-medium text-ink-2 underline decoration-line-strong underline-offset-4 transition hover:text-cyan-200 hover:decoration-cyan-300">
            Open Creator Studio
          </Link>
        </p>
      </div>
    </section>
  );
}
