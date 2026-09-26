/**
 * The four evidence labels, shared by the market-page brief and the landing
 * AI section so they read identically everywhere.
 */
export type EvidenceLayer = "observed" | "derived" | "interpretation" | "unknown";

export const EVIDENCE: Record<EvidenceLayer, { label: string; cls: string; dot: string; hint: string }> = {
  observed: {
    label: "Observed",
    cls: "border-cyan-400/40 bg-cyan-400/[0.06] text-cyan-200",
    dot: "bg-cyan-300",
    hint: "Read directly from Panta market or trade data",
  },
  derived: {
    label: "Derived",
    cls: "border-blue-500/45 bg-blue-500/[0.07] text-blue-200",
    dot: "bg-blue-300",
    hint: "Computed deterministically from observed data",
  },
  interpretation: {
    label: "Interpretation",
    cls: "border-violet-500/45 bg-violet-500/[0.07] text-violet-200",
    dot: "bg-violet-300",
    hint: "Generated text (LLM, or the template when AI is unavailable). Not a recommendation",
  },
  unknown: {
    label: "Unknown",
    cls: "border-amber-400/45 bg-amber-400/[0.06] text-amber-200",
    dot: "bg-amber-300",
    hint: "Important information the data does not contain",
  },
};

export function EvidenceTag({ layer, className = "" }: { layer: EvidenceLayer; className?: string }) {
  const e = EVIDENCE[layer];
  return (
    <span
      title={e.hint}
      className={`inline-flex w-fit items-center rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wider ${e.cls} ${className}`}
    >
      {e.label}
    </span>
  );
}

/** Legend row: all four labels in their fixed order. */
export function EvidenceLegend({ className = "" }: { className?: string }) {
  return (
    <span className={`flex flex-wrap gap-1 ${className}`} aria-label="Evidence labels">
      {(Object.keys(EVIDENCE) as EvidenceLayer[]).map((l) => (
        <EvidenceTag key={l} layer={l} />
      ))}
    </span>
  );
}
