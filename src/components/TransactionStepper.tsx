import type { ReactNode } from "react";
import type { StepMark } from "@/lib/trade-state";

export type StepState = StepMark;
export type TxStep = { id: string; label: string; state: StepState; detail?: ReactNode };

const STATE_LABEL: Record<StepState, string> = {
  waiting: "Waiting",
  active: "In progress",
  done: "Completed",
  failed: "Failed",
  warn: "Needs attention",
  pending: "Pending",
};

const DOT: Record<StepState, string> = {
  waiting: "border-line-strong bg-inset text-ink-3",
  active: "border-cyan-400 bg-cyan-400/15 text-cyan-200",
  done: "border-emerald-400/70 bg-emerald-400/15 text-emerald-200",
  failed: "border-rose-400/70 bg-rose-400/15 text-rose-200",
  warn: "border-amber-400/70 bg-amber-400/15 text-amber-200",
  pending: "border-sky-400/60 bg-sky-400/10 text-sky-200",
};

const TEXT: Record<StepState, string> = {
  waiting: "text-ink-3",
  active: "text-cyan-200",
  done: "text-emerald-300",
  failed: "text-rose-300",
  warn: "text-amber-300",
  pending: "text-sky-300",
};

const BAR: Record<StepState, string> = {
  waiting: "bg-line",
  active: "bg-cyan-400",
  done: "bg-emerald-400/80",
  failed: "bg-rose-400",
  warn: "bg-amber-400",
  pending: "bg-sky-400/70",
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
      ) : state === "pending" ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3">
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 3.8V6l1.5 1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
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
  orientation?: "vertical" | "horizontal" | "summary";
  label?: string;
  compact?: boolean;
}) {
  if (orientation === "summary") {
    // One segmented bar plus the step that needs the reader's eye (first not done).
    const firstOpen = steps.findIndex((s) => s.state !== "done");
    const f = firstOpen === -1 ? steps.length - 1 : firstOpen;
    const cur = steps[f];
    return (
      <div>
        <ol aria-label={label} className="flex gap-1">
          {steps.map((s, i) => (
            <li key={s.id} className="flex-1" aria-current={s.state === "active" ? "step" : undefined}>
              <span className={`block h-1.5 rounded-full ${BAR[s.state]}`} />
              <span className="sr-only">
                {i + 1} {s.label}: {STATE_LABEL[s.state]}
              </span>
            </li>
          ))}
        </ol>
        {cur ? (
          <p className="mt-2 text-[12px] text-ink-2" aria-hidden="true">
            Step <span className="font-num">{f + 1}</span> of {steps.length} · {cur.label} ·{" "}
            <span className={TEXT[cur.state]}>{STATE_LABEL[cur.state]}</span>
          </p>
        ) : null}
      </div>
    );
  }
  if (orientation === "horizontal") {
    return (
      <ol aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li key={s.id} className="min-w-0" aria-current={s.state === "active" ? "step" : undefined}>
            <div className={`h-1 rounded-full transition-colors duration-300 ${BAR[s.state]}`} />
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
