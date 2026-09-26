import { SectionHeader } from "../ui/SectionHeader";
import { IconBolt, IconShield, IconWallet } from "../ui/Icons";
import { TransactionStepper, type TxStep } from "../TransactionStepper";

const SAMPLE_STEPS: TxStep[] = [
  { id: "quote", label: "Quote", state: "done", detail: "Panta prices the buy on the primary curve." },
  { id: "build", label: "Build", state: "done", detail: "Unsigned transaction is built and checked before signing." },
  { id: "sign", label: "Sign", state: "active", detail: "Your wallet shows the transaction. You approve or reject." },
  { id: "broadcast", label: "Broadcast", state: "waiting", detail: "Signed transaction is sent to Solana." },
  { id: "confirm", label: "Confirm", state: "waiting", detail: "Marked confirmed only after the network confirms the signature." },
  { id: "verify", label: "Verify / Attribute", state: "waiting", detail: "Reported to Panta, then verified against its ledger." },
];

const TRUST = [
  { Icon: IconWallet, text: "Your wallet signs every transaction. We never ask for a private key or seed phrase." },
  { Icon: IconShield, text: "The app never holds your funds. Programs and fee payer are checked before you sign." },
  { Icon: IconBolt, text: "Amount and slippage are validated before a quote is requested." },
];

function Row({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`font-num ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>{v}</dd>
    </div>
  );
}

export function ExecutionShowcase() {
  return (
    <section className="border-t border-line bg-surface/30 py-20 sm:py-24" aria-labelledby="exec-title">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:items-start">
        <div>
          <SectionHeader
            eyebrow="Built for execution"
            id="exec-title"
            title="From market insight to wallet approval."
            description="Review the quote, understand the cost, and approve the transaction with your own wallet."
          />
          <div className="card mt-8 p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">Transaction lifecycle</p>
              <span className="text-[11px] text-ink-3">Example states</span>
            </div>
            <TransactionStepper steps={SAMPLE_STEPS} label="Example transaction lifecycle" />
          </div>
          <ul className="mt-6 space-y-3">
            {TRUST.map(({ Icon, text }) => (
              <li key={text} className="flex gap-3 text-[14px] leading-relaxed text-ink-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <figure className="card-elevated p-5 sm:p-6">
          <figcaption className="sr-only">Illustrative trade panel with sample values.</figcaption>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[17px] font-semibold text-ink">Execute Trade</p>
            <span className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
              Illustrative
            </span>
          </div>
          <div aria-hidden="true">
            <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl border border-line bg-inset p-1 text-center text-[14px] font-semibold">
              <span className="rounded-lg bg-elevated py-2 text-ink shadow-[inset_0_0_0_1px_var(--line-strong)]">Buy</span>
              <span className="py-2 text-ink-3 line-through decoration-ink-3/50">Sell</span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              Panta primary markets are buy-only. You exit by claiming after the market resolves.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <span className="rounded-xl border border-emerald-400/50 bg-emerald-400/10 py-3 text-center text-[14px] font-semibold text-emerald-200">
                YES · 64¢
              </span>
              <span className="rounded-xl border border-line bg-inset py-3 text-center text-[14px] font-semibold text-ink-3">NO · 36¢</span>
            </div>
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
              <div className="field flex items-center justify-between">
                <span className="text-[13px] text-ink-3">Amount</span>
                <span className="font-num text-[15px] text-ink">25.00</span>
              </div>
              <div className="field flex items-center gap-2 text-[13px] text-ink-2">USDC</div>
            </div>
            <div className="field mt-2 flex items-center justify-between">
              <span className="text-[13px] text-ink-3">Max slippage</span>
              <span className="font-num text-[14px] text-ink">1.00%</span>
            </div>
            <dl className="mt-4 divide-y divide-line rounded-xl border border-line bg-inset px-4 py-2">
              <Row k="Est. shares" v="~38.4 YES" strong />
              <Row k="Avg. price" v="0.651 USDC" />
              <Row k="Fee" v="0.25 USDC" />
              <Row k="Quote expires" v="0:42" />
            </dl>
            <div className="btn btn-primary btn-lg mt-5 w-full">Review &amp; Confirm</div>
            <p className="mt-3 text-center text-[12px] text-ink-3">
              Next: a review screen with market, side, amount, quote, fees and wallet, before your wallet opens.
            </p>
          </div>
        </figure>
      </div>
    </section>
  );
}
