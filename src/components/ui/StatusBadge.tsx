import type { ReactNode } from "react";

export type StatusTone =
  | "live"
  | "info"
  | "success"
  | "pending"
  | "warning"
  | "error"
  | "neutral"
  | "ai";

const TONE: Record<StatusTone, string> = {
  live: "border-cyan-400/35 bg-cyan-400/10 text-cyan-200",
  info: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  success: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200",
  pending: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  warning: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  error: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  neutral: "border-line-strong bg-elevated text-ink-2",
  ai: "border-violet-500/40 bg-violet-500/10 text-violet-200",
};

/** Glyph per tone so status is never communicated by colour alone. */
function Glyph({ tone }: { tone: StatusTone }) {
  const common = "h-2.5 w-2.5 shrink-0";
  switch (tone) {
    case "success":
      return (
        <svg className={common} viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 5.2 4.1 7.3 8 2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "error":
      return (
        <svg className={common} viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 2.5l5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "pending":
    case "warning":
      return (
        <svg className={common} viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 3v2.2l1.4.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "live":
      return <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />;
    case "ai":
      return (
        <svg className={common} viewBox="0 0 10 10" aria-hidden="true">
          <path d="M5 .8 6 4l3.2 1L6 6 5 9.2 4 6 .8 5 4 4z" fill="currentColor" />
        </svg>
      );
    default:
      return <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-current opacity-80" aria-hidden="true" />;
  }
}

export function StatusBadge({
  tone = "neutral",
  children,
  className = "",
  title,
  size = "sm",
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
  title?: string;
  size?: "xs" | "sm";
}) {
  const s = size === "xs" ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[11px]";
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border font-medium tracking-wide ${s} ${TONE[tone]} ${className}`}
    >
      <Glyph tone={tone} />
      {children}
    </span>
  );
}

/** Market phase → badge. Unknown API phases render as-is (neutral). */
export function phaseTone(phase?: string | null): { tone: StatusTone; label: string } {
  const p = (phase || "").toLowerCase();
  if (p === "primary") return { tone: "live", label: "Open" };
  if (p === "secondary") return { tone: "info", label: "Secondary" };
  if (p === "resolved") return { tone: "neutral", label: "Resolved" };
  if (p === "cancelled" || p === "canceled") return { tone: "error", label: "Cancelled" };
  return { tone: "neutral", label: phase ? phase : "Unknown" };
}
