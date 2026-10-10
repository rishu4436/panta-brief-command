import { IconLayers, IconPulse, IconRadar, IconShield, IconWallet } from "../../ui/Icons";

const ITEMS = [
  { Icon: IconPulse, title: "Live Panta markets", body: "The real catalog, prices and lifecycle." },
  { Icon: IconRadar, title: "Free wallet-based forecasting", body: "Sign once. No transaction, no fees." },
  { Icon: IconLayers, title: "Evidence-first intelligence", body: "Every line labelled by evidence type." },
  { Icon: IconShield, title: "Community reputation", body: "Scored only after verified resolution." },
  { Icon: IconWallet, title: "Wallet-controlled execution", body: "You approve every transaction." },
];

/** B. One positioning line, five capabilities on a hairline rail. */
export function CapabilityRail() {
  return (
    <section aria-labelledby="capabilities-title" className="relative border-y border-line/70 bg-bg/70">
      <div className="mx-auto max-w-[1360px] px-5 sm:px-8">
        <h2 id="capabilities-title" className="lv-mono py-4 text-center sm:py-5 text-[11px] uppercase tracking-[0.16em] text-ink-3 lg:text-left">
          A prediction-market platform for <span className="text-ink-2">intelligence, forecasting, community and execution</span>
        </h2>
        <ul className="grid grid-cols-2 border-t border-line/60 lg:grid-cols-5">
          {ITEMS.map(({ Icon, title, body }, i) => (
            <li
              key={title}
              className={`flex gap-2.5 border-line/60 py-3.5 sm:gap-3 sm:py-5 lg:flex-col lg:gap-2.5 lg:px-6 lg:py-6 ${i > 0 ? "lg:border-l" : "lg:pl-0"} ${i % 2 === 1 ? "border-l pl-3 sm:pl-5 lg:pl-6" : "pr-2"} ${i < 4 ? "border-b lg:border-b-0" : ""} ${i === 4 ? "col-span-2 lg:col-span-1" : ""}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300 sm:h-[18px] sm:w-[18px]" />
              <div>
                <p className="text-[13px] font-semibold leading-snug tracking-[-0.01em] text-ink sm:text-[14px]">{title}</p>
                <p className="mt-0.5 hidden text-[13px] leading-snug text-ink-3 sm:block">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
