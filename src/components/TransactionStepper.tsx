import type { ReactNode } from "react";

export type StepState = "waiting" | "active" | "done" | "failed" | "warn";
export type TxStep = { id: string; label: string; state: StepState; detail?: ReactNode };

const STATE_LABEL: Record<StepState, string> = {
  waiting: "Waiting",
  active: "In progress",
  done: "Completed",
  failed: "Failed",
  warn: "Needs attention",
};

const DOT: Record<StepState, string> = {
  waiting: "border-line-strong bg-inset text-ink-3",
  active: "border-cyan-400 bg-cyan-400/15 text-cyan-200",
  done: "border-emerald-400/70 bg-emerald-400/15 text-emerald-200",
  failed: "border-rose-400/70 bg-rose-400/15 text-rose-200",
  warn: "border-amber-400/70 bg-amber-400/15 text-amber-200",
};

const TEXT: Record<StepState, string> = {
  waiting: "text-ink-3",
  active: "text-cyan-200",
  done: "text-emerald-300",
  failed: "text-rose-300",
  warn: "text-amber-300",
};

function Marker({ state, index }: { state: StepState; index: number }) {
  return (
    <span
      className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors duration-300 ${DOT[state]}`}
      aria-hidden="true"
    >
      {state === "done" ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3">
          <path d="M2.5 6.3 5 8.7 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : state === "failed" ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3">
          <path d="m3.5 3.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : state === "active" ? (
        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
      ) : state === "warn" ? (
        "!"
      ) : (
        index + 1
      )}
    </span>
  );
}

/**
 * Transaction lifecycle: Quote → Build → Sign → Broadcast → Confirm →
 * Verify / Attribute. Each step shows a text state (never colour alone).
 */
export function TransactionStepper({
  steps,
  orientation = "vertical",
  label = "Transaction progress",
  compact = false,
}: {
  steps: TxStep[];
  orientation?: "vertical" | "horizontal";
  label?: string;
  compact?: boolean;
}) {
  if (orientation === "horizontal") {
    return (
      <ol aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li key={s.id} className="min-w-0" aria-current={s.state === "active" ? "step" : undefined}>
            <div className={`h-1 rounded-full transition-colors duration-300 ${s.state === "done" ? "bg-emerald-400/80" : s.state === "active" ? "bg-cyan-400" : s.state === "failed" ? "bg-rose-400" : s.state === "warn" ? "bg-amber-400" : "bg-line"}`} />
            <p className="mt-1.5 truncate text-[11px] font-medium text-ink-2">
              <span className="font-num text-ink-3">{i + 1}</span> {s.label}
            </p>
            <p className={`truncate text-[10px] ${TEXT[s.state]}`}>{STATE_LABEL[s.state]}</p>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol aria-label={label} className="relative">
      {steps.map((s, i) => (
        <li key={s.id} className={`relative flex gap-3 ${compact ? "pb-3" : "pb-4"} last:pb-0`} aria-current={s.state === "active" ? "step" : undefined}>
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className={`absolute left-[13px] top-7 bottom-0 w-px ${s.state === "done" ? "bg-emerald-400/40" : "bg-line"}`}
            />
          )}
          <Marker state={s.state} index={i} />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[13px] font-semibold text-ink">
                <span className="font-num mr-1 text-ink-3">{i + 1}</span>
                {s.label}
              </p>
              <p className={`text-[11px] font-medium ${TEXT[s.state]}`}>{STATE_LABEL[s.state]}</p>
            </div>
            {s.detail ? <div className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{s.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
