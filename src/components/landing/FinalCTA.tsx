import Link from "next/link";
import { IconArrowRight } from "../ui/Icons";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-line/70 py-14 sm:py-16" aria-labelledby="cta-title">
      <div className="glow-soft pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto flex max-w-[1120px] flex-col items-center gap-6 px-5 text-center sm:px-8 lg:flex-row lg:justify-between lg:text-left">
        <div>
          <h2 id="cta-title" className="h-section">
            Open the desk.
          </h2>
          <p className="text-lede mt-2 max-w-xl">Live markets, labelled evidence and wallet-approved execution.</p>
        </div>
        <Link href="/desk" className="btn btn-primary btn-lg shrink-0">
          Open Trading Desk <IconArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
