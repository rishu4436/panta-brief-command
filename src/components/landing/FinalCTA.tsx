import Link from "next/link";
import { IconArrowRight } from "../ui/Icons";

export function FinalCTA() {
  return (
    <section className="px-5 pb-20 sm:px-8 sm:pb-24" aria-labelledby="cta-title">
      <div className="relative mx-auto max-w-[1120px] overflow-hidden rounded-3xl border border-line-strong bg-surface px-6 py-14 text-center sm:px-12">
        <div className="glow-soft pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative">
          <h2 id="cta-title" className="h-section">
            Your market workflow starts here.
          </h2>
          <p className="text-lede mx-auto mt-3 max-w-xl">
            Discover markets, understand the activity, and manage execution from one desk.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/desk" className="btn btn-primary btn-lg">
              Open Trading Desk <IconArrowRight className="h-4 w-4" />
            </Link>
            <a href="#how-it-works" className="btn btn-secondary btn-lg">
              Explore How It Works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
