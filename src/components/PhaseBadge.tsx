export function PhaseBadge({ phase }: { phase?: string }) {
  const p = (phase || "—").toLowerCase();
  const color =
    p === "primary"
      ? "bg-cyan-500/15 text-cyan-300 border-cyan-400/30"
      : p === "secondary"
        ? "bg-violet-500/15 text-violet-300 border-violet-400/30"
        : p === "resolved"
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
          : "bg-zinc-500/15 text-zinc-300 border-zinc-400/30";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${color}`}
    >
      {phase || "—"}
    </span>
  );
}
