import { IconBolt, IconPortfolio, IconPulse, IconSparkles } from "../ui/Icons";

const ITEMS = [
  { n: "01", title: "Live Market Data", body: "Market discovery and activity from Panta.", Icon: IconPulse, tone: "text-cyan-300" },
  { n: "02", title: "AI-Powered Briefs", body: "Structured insights based on market evidence.", Icon: IconSparkles, tone: "text-violet-300" },
  { n: "03", title: "Solana Execution", body: "Review and approve transactions with your wallet.", Icon: IconBolt, tone: "text-blue-300" },
  { n: "04", title: "Portfolio & Activity", body: "Monitor positions, claims, and attributed trades.", Icon: IconPortfolio, tone: "text-emerald-300" },
];

export function CapabilityStrip() {
  return (
    <section aria-label="Capabilities" className="border-y border-line bg-surface/40">
      <ul className="mx-auto grid max-w-[1320px] grid-cols-2 px-5 sm:px-8 lg:grid-cols-4">
        {ITEMS.map(({ n, title, body, Icon, tone }, i) => (
          <li
            key={n}
            className={`flex gap-3 py-6 pr-4 lg:px-6 lg:py-7 ${i > 0 ? "lg:border-l lg:border-line" : "lg:pl-0"} ${i % 2 === 1 ? "border-l border-line pl-4 lg:pl-6" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""}`}
          >
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-bg ${tone}`}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-ink">
                <span className="font-num mr-1.5 text-ink-3">{n}</span>
                {title}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
