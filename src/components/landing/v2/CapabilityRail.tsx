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
        <h2 id="capabilities-title" className="lv-mono py-5 text-center text-[11px] uppercase tracking-[0.16em] text-ink-3 lg:text-left">
          A prediction-market platform for <span className="text-ink-2">intelligence, forecasting, community and execution</span>
        </h2>
        <ul className="grid grid-cols-1 border-t border-line/60 min-[480px]:grid-cols-2 lg:grid-cols-5">
          {ITEMS.map(({ Icon, title, body }, i) => (
            <li
              key={title}
              className={`flex gap-3 border-line/60 py-5 lg:flex-col lg:gap-2.5 lg:px-6 lg:py-6 ${i > 0 ? "lg:border-l" : "lg:pl-0"} ${i % 2 === 1 ? "min-[480px]:border-l min-[480px]:pl-5 lg:pl-6" : ""} ${i < 4 ? "border-b min-[480px]:border-b lg:border-b-0" : ""}`}
            >
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-cyan-300" />
              <div>
                <p className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
