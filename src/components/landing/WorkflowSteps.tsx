import { IconArrowRight } from "../ui/Icons";

/**
 * One connected path, four stops. Each stop names what the app actually does
 * and links to the section below that shows it.
 */
const STEPS = [
  { n: "01", title: "Discover", body: "Filter the live catalog by category and phase; sort by volume or end date.", href: "#live-markets", cta: "See live markets" },
  { n: "02", title: "Understand", body: "Read probability, recent flow and trades, with every brief line labelled by evidence type.", href: "#ai-brief", cta: "How briefs work" },
  { n: "03", title: "Execute", body: "Quote, review fees and the checked transaction, then approve in your own wallet.", href: "#execution", cta: "Trade states" },
  { n: "04", title: "Track", body: "Positions, claims and attributed activity, with confirmation and attribution kept separate.", href: "#book", cta: "Your Book" },
];

export function WorkflowSteps() {
  return (
    <section id="how-it-works" className="scroll-mt-20 py-14 sm:py-16" aria-labelledby="how-title">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="how-title" className="h-section max-w-xl">
            From market data to execution in four steps.
          </h2>
          <p className="max-w-sm text-[14px] leading-relaxed text-ink-3">The same order you work in on the desk.</p>
        </div>

        <ol className="relative mt-8 grid gap-5 md:mt-10 md:grid-cols-4 md:gap-6">
          {/* Connecting path (desktop: horizontal, mobile: vertical) */}
          <span
            aria-hidden="true"
            className="absolute left-[19px] top-2 bottom-2 w-px bg-gradient-to-b from-cyan-400/60 via-blue-500/40 to-violet-500/50 md:left-5 md:right-5 md:top-[19px] md:bottom-auto md:h-px md:w-auto md:bg-gradient-to-r"
          />
          {STEPS.map((s) => (
            <li key={s.n} className="relative grid grid-cols-[40px_1fr] gap-4 md:block">
              <span className="relative z-10 flex h-10 w-10 md:mt-0 items-center justify-center rounded-full border border-cyan-400/40 bg-bg font-num text-[13px] font-semibold text-cyan-200 shadow-[0_0_0_4px_var(--bg)]">
                {s.n}
              </span>
              <div className="md:mt-4">
                <h3 className="text-[17px] font-semibold text-ink">
                  <a href={s.href} className="group inline-flex min-h-11 items-center gap-1.5 hover:text-cyan-200 md:min-h-0">
                    {s.title}
                    <IconArrowRight className="h-3.5 w-3.5 text-cyan-300 transition-transform group-hover:translate-x-0.5" />
                    <span className="sr-only">: {s.cta}</span>
                  </a>
                </h3>
                <p className="max-w-xs text-[14px] leading-relaxed text-ink-3 md:mt-1.5">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
