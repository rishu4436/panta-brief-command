import { phaseTone, StatusBadge } from "./ui/StatusBadge";

export function PhaseBadge({ phase, size = "sm" }: { phase?: string; size?: "xs" | "sm" }) {
  const { tone, label } = phaseTone(phase);
  return (
    <StatusBadge tone={tone} size={size} title={phase ? `Panta phase: ${phase}` : undefined}>
      {label}
    </StatusBadge>
  );
}
