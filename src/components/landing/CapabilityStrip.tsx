import { IconLayers, IconPulse, IconShield, IconWallet } from "../ui/Icons";

/**
 * Slim proof row under the hero: four verifiable facts about how the app
 * behaves (not a feature list; the sections below explain each part).
 */
const PROOF = [
  { Icon: IconPulse, text: "Live Panta data, no demo feed" },
  { Icon: IconLayers, text: "Evidence-labelled briefs" },
  { Icon: IconShield, text: "Pre-sign check on every trade" },
  { Icon: IconWallet, text: "Keys stay in your wallet" },
];

export function CapabilityStrip() {
  return (
    <section aria-label="How Brief Command behaves" className="border-y border-line/70 bg-bg/60">
      <ul className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-center gap-x-0 gap-y-2 px-5 py-4 sm:px-8 lg:justify-between">
        {PROOF.map(({ Icon, text }, i) => (
          <li
            key={text}
            className={`flex min-h-8 items-center whitespace-nowrap gap-2 px-4 text-[13px] text-ink-2 ${i > 0 ? "sm:border-l sm:border-line" : ""} lg:flex-1 lg:justify-center`}
          >
            <Icon className="h-4 w-4 shrink-0 text-cyan-300" />
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}
