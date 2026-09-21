export function PhaseBadge({ phase }: { phase?: string }) {
  const p = (phase || "—").toLowerCase();
  const color =
    p === "primary"
      ? "bg-cyan-400/10 text-cyan-300 border-cyan-400/25"
      : p === "secondary"
        ? "bg-zinc-400/10 text-zinc-300 border-zinc-400/25"
        : p === "resolved"
          ? "bg-emerald-400/10 text-emerald-300 border-emerald-400/25"
          : p === "cancelled"
            ? "bg-rose-400/10 text-rose-300 border-rose-400/25"
            : "bg-zinc-500/10 text-zinc-400 border-zinc-500/25";
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${color}`}
    >
      {phase || "—"}
    </span>
  );
}
