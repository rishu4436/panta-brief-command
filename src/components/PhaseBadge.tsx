import { LIFECYCLE_LABEL, marketLifecycle } from "@/lib/panta/catalog";
import type { Market } from "@/lib/panta/domain";
import { phaseTone, StatusBadge } from "./ui/StatusBadge";

export function PhaseBadge({ phase, size = "sm" }: { phase?: string; size?: "xs" | "sm" }) {
  const { tone, label } = phaseTone(phase);
  return (
    <StatusBadge tone={tone} size={size} title={phase ? `Panta phase: ${phase}` : undefined}>
      {label}
    </StatusBadge>
  );
}

/** Badge from the market's lifecycle (phase + end time + primary window), not the raw phase. */
export function LifecycleBadge({ market, size = "sm" }: { market: Market; size?: "xs" | "sm" }) {
  const lc = marketLifecycle(market);
  const { tone, label } = phaseTone(lc);
  return (
    <StatusBadge tone={tone} size={size} title={`${LIFECYCLE_LABEL[lc]}${market.phase ? ` · Panta phase: ${market.phase}` : ""}`}>
      {label}
    </StatusBadge>
  );
}
