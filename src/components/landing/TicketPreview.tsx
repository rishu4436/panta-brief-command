import { TRADE_STATES, formatClock, type TradeStateId } from "@/lib/trade-state";
import { Panel } from "../Panel";
import { TransactionStepper } from "../TransactionStepper";
import { MarketSummary, QuoteSummary, SideToggle, stepsForState } from "../trade/TicketParts";
import { TradeStateNotice } from "../trade/TradeStateNotice";
import { SAMPLE_ENDS_LABEL, SAMPLE_MARKET, SAMPLE_QUOTE } from "./sample";

/** States that exist before a quote: no quote block, no stepper. */
const PRE_QUOTE = new Set<TradeStateId>(["disconnected", "ready", "quoting"]);

/**
 * The desk's Execute Trade ticket, assembled from the same parts
 * (SideToggle, QuoteSummary, TradeStateNotice, TransactionStepper) with
 * sample values. Illustrative only; actions are inert.
 */
export function TicketPreview({
  state,
  secondsLeft = 47,
  elapsedSec = 12,
  stepper = true,
  className = "",
}: {
  state: TradeStateId;
  secondsLeft?: number;
  elapsedSec?: number;
  stepper?: boolean;
  className?: string;
}) {
  const spec = TRADE_STATES[state];
  const hasQuote = !PRE_QUOTE.has(state);
  const sent = ["confirming", "confirm_timeout", "tx_failed", "confirmed", "submit_failed", "verifying", "verify_slow", "verify_failed", "reported", "verified", "attributed"].includes(state);
  const expired = state === "quote_expired";
  const meta =
    state === "verifying" || state === "verify_slow"
      ? `${state === "verify_slow" ? 31 : elapsedSec}s elapsed`
      : state === "quote_ready" || state === "review"
        ? `Expires in ${formatClock(secondsLeft)}`
        : undefined;
  return (
    <Panel
      title="Execute Trade"
      subtitle="Primary buy"
      className={className}
      action={<span className="mr-1 text-[11px] text-ink-3">{spec.title}</span>}
    >
      <div className="space-y-3">
        <MarketSummary title={SAMPLE_MARKET.title} phase={SAMPLE_MARKET.phase} endsLabel={SAMPLE_ENDS_LABEL} />
        <div className="grid grid-cols-2 gap-3">
          <SideToggle side="yes" preview />
          <div>
            <div className="text-[12px] text-ink-3">Amount (USDC)</div>
            <div className="field mt-1 flex items-center font-num text-ink">25.00</div>
          </div>
        </div>
        {hasQuote && (
          <QuoteSummary
            quote={SAMPLE_QUOTE}
            slippageBps={100}
            secondsLeft={sent ? null : expired ? 0 : secondsLeft}
            totalSeconds={sent ? null : 60}
            ttlSource="panta"
            stale={state === "quote_stale"}
          />
        )}
        <TradeStateNotice state={state} meta={meta} signature={sent ? "sample" : null} preview />
        {stepper && hasQuote && (
          <div className="rounded-xl border border-line bg-inset p-3">
            <TransactionStepper steps={stepsForState(state)} orientation="horizontal" label="Example transaction progress" />
          </div>
        )}
      </div>
    </Panel>
  );
}
