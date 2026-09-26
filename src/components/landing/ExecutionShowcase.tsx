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
 * Centred stage: the desk's own ticket components, switched between the
 * states that matter most for trust. Sample values, clearly labelled.
 */
export function ExecutionShowcase() {
  const [state, setState] = useState<TradeStateId>("quote_ready");
  return (
    <section id="execution" className="relative scroll-mt-20 overflow-hidden py-14 sm:py-16" aria-labelledby="exec-title">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse 55% 60% at 50% 55%, rgba(18,214,245,0.07), transparent 70%)" }}
        aria-hidden="true"
      />
      <div className="mx-auto max-w-[1120px] px-5 text-center sm:px-8">
        <p className="eyebrow">Execution</p>
        <h2 id="exec-title" className="h-section mx-auto mt-3 max-w-3xl">
          Clear when it works. Clearer when it doesn&apos;t.
        </h2>
        <p className="text-lede mx-auto mt-3 max-w-2xl">
          Every state says what happened, what is safe, and the one next step. The desk ticket uses these exact components.
        </p>

        <div className="mt-8 flex justify-center">
          <div className="segmented max-w-full flex-wrap justify-center" role="group" aria-label="Preview a trade state">
            {STATES.map((s) => (
              <button key={s.id} type="button" className="min-h-11 whitespace-nowrap" aria-pressed={state === s.id} onClick={() => setState(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <figure className="mx-auto mt-6 max-w-[740px] text-left">
          <figcaption className="mb-3 flex flex-wrap items-center justify-center gap-2 text-[12px] text-ink-3">
            <span className="whitespace-nowrap rounded-md border border-amber-400/50 bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
              Illustrative preview
            </span>
            Sample values · actions disabled
          </figcaption>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_250px] md:items-start">
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
    </section>
  );
}
