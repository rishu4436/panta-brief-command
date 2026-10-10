import Link from "next/link";
import { IconArrowRight } from "../../ui/Icons";
import { Kicker } from "./primitives";

const FORECAST = [
  ["Choose a market", "Any live Panta market can anchor a room."],
  ["Join a Prediction Room", "A creator-owned space around that one market."],
  ["Make a free probability forecast", "A signed message proves your wallet. Nothing is sent on-chain."],
  ["Revise while the market is open", "Every revision is kept in your history."],
  ["Compare with the consensus", "See where you sit in the room's distribution."],
  ["Build a track record", "Scored after the outcome is verified."],
] as const;

const TRADE = [
  ["Research the market", "Price, flow, evidence labels and risk flags."],
  ["Review YES / NO prices", "Live spot prices from Panta."],
  ["Understand execution conditions", "Quote, average price, fees and expiry."],
  ["Approve a validated transaction", "Checked before your wallet is asked to sign."],
  ["Track positions and claims", "Confirmation and attribution kept separate."],
] as const;

function Steps({ steps, tone }: { steps: readonly (readonly [string, string])[]; tone: "forecast" | "trade" }) {
  const dot = tone === "forecast" ? "border-emerald-400/60 text-emerald-200" : "border-blue-400/60 text-blue-200";
  const line = tone === "forecast" ? "from-emerald-400/50" : "from-blue-400/50";
  return (
    <ol className="relative mt-7 space-y-5">
      <span aria-hidden="true" className={`absolute bottom-3 left-[13px] top-3 w-px bg-gradient-to-b ${line} to-transparent`} />
      {steps.map(([title, body], i) => (
        <li key={title} className="relative grid grid-cols-[28px_1fr] gap-4">
          <span className={`lv-mono relative z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-bg text-[11px] ${dot}`}>{i + 1}</span>
          <div className="pt-0.5">
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</p>
            <p className="mt-0.5 text-[13.5px] leading-snug text-ink-3">{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** C. Forecast and Trade: connected, clearly separate. */
export function ParticipationPaths() {
  return (
    <section aria-labelledby="paths-title" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-[1360px] px-5 sm:px-8">
        <div className="lv-reveal grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <div>
            <Kicker index="01">Participation</Kicker>
            <h2 id="paths-title" className="lv-h2 mt-5">
              Two ways to take part. <span className="lv-accent text-ink-2">One workspace.</span>
            </h2>
          </div>
          <p className="lv-lede max-w-md lg:justify-self-end">
            Forecast for free, or trade with real funds from your own wallet. The paths share research and markets, never money: a forecast
            never places a trade.
          </p>
        </div>

        <div className="relative mt-14 grid gap-5 lg:grid-cols-2 lg:gap-0">
          <article className="lv-reveal lv-panel lv-panel--flat overflow-hidden p-6 sm:p-9 lg:rounded-r-none lg:border-r-0" aria-labelledby="path-forecast">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-emerald-400/70 via-emerald-400/20 to-transparent" aria-hidden="true" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="lv-mono text-[11px] uppercase tracking-[0.16em] text-emerald-300">Path 1 · Forecast</p>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/[0.07] px-2.5 py-1 text-[11px] font-medium text-emerald-100">No funds needed</span>
            </div>
            <h3 id="path-forecast" className="lv-h3 mt-4">Say what you think will happen.</h3>
            <Steps steps={FORECAST} tone="forecast" />
            <Link href="/rooms" className="lv-link mt-6">
              Find a room to forecast in <IconArrowRight className="h-4 w-4" />
            </Link>
          </article>

          {/* Divider: the one rule that connects and separates the paths */}
          <div className="relative flex items-center justify-center lg:absolute lg:inset-y-0 lg:left-1/2 lg:z-10 lg:-translate-x-1/2">
            <div className="hidden h-full w-px bg-gradient-to-b from-line-strong via-line-strong/60 to-transparent lg:block" aria-hidden="true" />
            <p className="lv-mono rounded-full border border-line-strong bg-bg px-3.5 py-1.5 text-center text-[10.5px] uppercase tracking-[0.12em] text-ink-2 lg:absolute lg:top-0 lg:-translate-y-1/2 lg:whitespace-nowrap">
              Forecasts never execute trades
            </p>
          </div>

          <article className="lv-reveal lv-panel lv-panel--flat overflow-hidden p-6 sm:p-9 lg:rounded-l-none" aria-labelledby="path-trade">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-l from-blue-400/70 via-blue-400/20 to-transparent" aria-hidden="true" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="lv-mono text-[11px] uppercase tracking-[0.16em] text-blue-300">Path 2 · Trade</p>
              <span className="rounded-full border border-blue-400/35 bg-blue-500/[0.08] px-2.5 py-1 text-[11px] font-medium text-blue-100">Real funds · your wallet</span>
            </div>
            <h3 id="path-trade" className="lv-h3 mt-4">Take a position when you choose.</h3>
            <Steps steps={TRADE} tone="trade" />
            <Link href="/desk" className="lv-link mt-6">
              Open the Trading Desk <IconArrowRight className="h-4 w-4" />
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}
