"use client";

import { useState } from "react";
import type { TradeStateId } from "@/lib/trade-state";
import { TransactionStepper } from "../TransactionStepper";
import { stepsForState } from "../trade/TicketParts";
import { TicketPreview } from "./TicketPreview";

const STATES: { id: TradeStateId; label: string }[] = [
  { id: "quote_ready", label: "Ready" },
  { id: "disconnected", label: "Wallet disconnected" },
  { id: "quote_expired", label: "Quote expired" },
  { id: "signature_rejected", label: "Signature rejected" },
  { id: "verifying", label: "Verifying" },
  { id: "verify_slow", label: "Still verifying" },
  { id: "attributed", label: "Verified" },
];

/**
 * The desk's own ticket components, switched between the states that matter
 * most for trust. Sample values, clearly labelled; actions are inert.
 */
export function ExecutionStage() {
  const [state, setState] = useState<TradeStateId>("quote_ready");
  return (
    <div>
      {/* Phones: one compact control instead of seven wrapping buttons. */}
      <label className="flex items-center gap-3 sm:hidden">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Trade state</span>
        <select className="field min-h-11 flex-1 py-2 text-[14px]" value={state} onChange={(e) => setState(e.target.value as TradeStateId)}>
          {STATES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="hidden sm:block">
        <div className="segmented max-w-full flex-wrap" role="group" aria-label="Preview a trade state">
          {STATES.map((s) => (
            <button key={s.id} type="button" className="min-h-[30px] whitespace-nowrap" aria-pressed={state === s.id} onClick={() => setState(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <figure className="mt-4 text-left">
        <figcaption className="sr-only">Illustrative trade ticket with sample values; actions disabled.</figcaption>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_230px] md:items-start">
          <TicketPreview state={state} stepper={false} className="shadow-[0_30px_80px_-30px_rgba(18,214,245,0.25)]" />
          <div className="rounded-xl border border-line/70 bg-bg/40 p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Transaction progress</p>
            {state === "disconnected" ? (
              <p className="text-[13px] leading-relaxed text-ink-3">No quote yet. Progress starts once a wallet is connected and a quote is requested.</p>
            ) : (
              <>
                <div className="md:hidden">
                  <TransactionStepper steps={stepsForState(state)} orientation="summary" label="Example transaction progress" />
                </div>
                <div className="hidden md:block">
                  <TransactionStepper steps={stepsForState(state)} label="Example transaction progress" />
                </div>
              </>
            )}
          </div>
        </div>
      </figure>
    </div>
  );
}
