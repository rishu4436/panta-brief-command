import type { ReactNode } from "react";
import { STEP_LABEL, STEP_ORDER, formatClock, stepMarksFor, type StepId, type TradeStateId } from "@/lib/trade-state";
import type { TxStep } from "../TransactionStepper";
import { StatusBadge, phaseTone } from "../ui/StatusBadge";

/** Stepper rows for a trade state, with optional real per-step details. */
export function stepsForState(state: TradeStateId, details: Partial<Record<StepId, ReactNode>> = {}): TxStep[] {
  const marks = stepMarksFor(state);
  return STEP_ORDER.map((id) => ({ id, label: STEP_LABEL[id], state: marks[id], detail: details[id] }));
}

/** YES / NO outcome toggle (desk ticket + preview). */
export function SideToggle({
  side,
  onChange,
  disabled = false,
  preview = false,
}: {
  side: "yes" | "no";
  onChange?: (s: "yes" | "no") => void;
  disabled?: boolean;
  preview?: boolean;
}) {
  return (
    <div>
      <div className="text-[12px] text-ink-3" id={preview ? undefined : "side-label"}>
        Outcome
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2" role="group" aria-labelledby={preview ? undefined : "side-label"}>
        {(["yes", "no"] as const).map((s) => (
          <button
            key={s}
            type="button"
            tabIndex={preview ? -1 : undefined}
            aria-pressed={side === s}
            disabled={disabled}
            onClick={() => onChange?.(s)}
            className={`side-btn ${s === "yes" ? "side-yes" : "side-no"}`}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Market name + phase + end time, as shown at the top of the ticket. */
export function MarketSummary({ title, phase, endsLabel }: { title: string; phase?: string | null; endsLabel?: string | null }) {
  const ph = phase ? phaseTone(phase) : null;
  return (
    <div className="rounded-xl border border-line bg-inset px-3 py-2.5">
      <div className="text-[13px] font-medium leading-snug text-ink">{title}</div>
      {(ph || endsLabel) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
          {ph ? (
            <StatusBadge tone={ph.tone} size="xs">
              {ph.label}
            </StatusBadge>
          ) : null}
          {endsLabel ? (
            <>
              <span className="text-ink-3">Ends</span>
              <span className="font-num text-ink-2">{endsLabel}</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

export type QuoteView = {
  amountUsdc: string;
  shares: string;
  side: "yes" | "no";
  avgPrice: string;
  feeUsdc: string;
};

/**
 * Quote block with its countdown. `secondsLeft` null = no clock (e.g. before
 * the first tick). The bar drains as the quote ages; at 0 it reads Expired.
 */
export function QuoteSummary({
  quote,
  slippageBps,
  secondsLeft,
  totalSeconds,
  ttlSource,
  stale = false,
}: {
  quote: QuoteView;
  slippageBps: number | null;
  secondsLeft: number | null;
  totalSeconds: number | null;
  ttlSource: "panta" | "fallback";
  stale?: boolean;
}) {
  const expired = secondsLeft === 0;
  const warn = stale || expired;
  const frac = secondsLeft != null && totalSeconds ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : null;
  const low = secondsLeft != null && secondsLeft <= 10;
  return (
    <div className={`rounded-xl border p-3.5 ${warn ? "border-amber-400/30 bg-amber-400/[0.04]" : "border-line bg-inset"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-ink-2">Quote</p>
        {stale ? (
          <StatusBadge tone="warning" size="xs">
            Inputs changed
          </StatusBadge>
        ) : expired ? (
          <StatusBadge tone="warning" size="xs">
            Expired
          </StatusBadge>
        ) : secondsLeft != null ? (
          <span className={`font-num text-[12px] font-medium ${low ? "text-amber-300" : "text-ink-2"}`} aria-label={`Quote expires in ${secondsLeft} seconds`}>
            Expires in {formatClock(secondsLeft)}
          </span>
        ) : null}
      </div>
      {frac != null && !stale && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${expired ? "bg-amber-400/60" : low ? "bg-amber-400" : "bg-cyan-400/80"}`}
            style={{ width: `${frac * 100}%` }}
          />
        </div>
      )}
      <p className={`mt-2 text-[14px] ${warn ? "text-ink-3 line-through decoration-ink-3/60" : "text-ink"}`}>
        Pay <span className="font-num font-semibold">{quote.amountUsdc} USDC</span> → ~
        <span className="font-num font-semibold">{quote.shares}</span> {quote.side.toUpperCase()}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11px]">
        <div>
          <dt className="text-ink-3">Avg. price</dt>
          <dd className="font-num mt-0.5 font-medium text-ink">{quote.avgPrice}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Fee</dt>
          <dd className="font-num mt-0.5 font-medium text-ink">{quote.feeUsdc} USDC</dd>
        </div>
        <div>
          <dt className="text-ink-3">Max slippage</dt>
          <dd className="font-num mt-0.5 font-medium text-ink">{slippageBps != null ? `${slippageBps} bps` : "—"}</dd>
        </div>
      </dl>
      {ttlSource === "fallback" && !stale && (
        <p className="mt-2 text-[11px] text-ink-3">Panta sent no expiry time, so this ticket assumes 60 s (Panta documents ~90 s quote sessions).</p>
      )}
    </div>
  );
}
