import { EvidenceTag } from "../../brief/EvidenceTag";
import { IconCheck, IconShield, IconSparkles, IconWallet } from "../../ui/Icons";
import { SAMPLE_QUOTE } from "../sample";
import { DEMO_BUCKETS, DEMO_CONSENSUS, DEMO_FLOW, DEMO_MARKET, DEMO_PARTICIPANTS } from "./demo";
import { Histogram, Illustrative, ProbBar, Sparkline } from "./primitives";

function MarketPanel() {
  return (
    <div className="lv-panel overflow-hidden">
      <div className="lv-panel-head">
        <span className="lv-label flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> Market intelligence
        </span>
        <Illustrative />
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span className="rounded border border-line px-1.5 py-0.5">{DEMO_MARKET.category}</span>
          <span className="rounded border border-emerald-400/30 px-1.5 py-0.5 text-emerald-200">Primary · open</span>
          <span className="lv-mono hidden sm:inline">Market price · sample</span>
        </div>
        <p className="mt-2.5 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-ink sm:text-[19px]">{DEMO_MARKET.title}</p>
        <div className="mt-4 flex items-end gap-x-6">
          <div>
            <p className="lv-label">Yes</p>
            <p className="lv-mono text-[30px] font-semibold leading-none text-emerald-300 sm:text-[34px]">{DEMO_MARKET.yes}%</p>
          </div>
          <div>
            <p className="lv-label">No</p>
            <p className="lv-mono text-[30px] font-semibold leading-none text-rose-300 sm:text-[34px]">{DEMO_MARKET.no}%</p>
          </div>
        </div>
        <ProbBar yes={DEMO_MARKET.yes} className="mt-3" />
        <div className="mt-4 rounded-xl border border-line/70 bg-inset/60 p-3">
          <div className="flex items-center justify-between text-[10px]">
            <span className="lv-label">YES share of flow · 24 prints</span>
            <span className="lv-mono text-cyan-200">{Math.round(DEMO_FLOW[DEMO_FLOW.length - 1] * 100)}%</span>
          </div>
          <Sparkline values={DEMO_FLOW} baseline={DEMO_MARKET.yes / 100} fillId="hero-flow" className="mt-2 h-14 w-full" />
        </div>
        <ul className="mt-3 hidden space-y-2 text-[12px] leading-snug text-ink-2 sm:block">
          <li className="flex items-start gap-2.5">
            <EvidenceTag layer="observed" className="mt-px shrink-0" />
            <span>Market prices YES at {DEMO_MARKET.yes}%.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <EvidenceTag layer="derived" className="mt-px shrink-0" />
            <span>Flow runs above price; one wallet is a large share.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <EvidenceTag layer="unknown" className="mt-px shrink-0" />
            <span>Who the buyers are, and why.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function RoomPanel() {
  return (
    <div className="lv-panel overflow-hidden">
      <div className="lv-panel-head">
        <span className="lv-label flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Prediction Room
        </span>
        <span className="lv-mono text-[10px] text-emerald-200">Free · no funds</span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line/70 bg-inset/60 px-3 py-2">
            <p className="lv-label flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rotate-45 bg-ink" /> Market
            </p>
            <p className="lv-mono mt-1 text-[22px] font-semibold leading-none text-ink">{DEMO_MARKET.yes}%</p>
          </div>
          <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.05] px-3 py-2">
            <p className="lv-label flex items-center gap-1.5 !text-emerald-200/80">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Community
            </p>
            <p className="lv-mono mt-1 text-[22px] font-semibold leading-none text-emerald-200">{DEMO_CONSENSUS}%</p>
          </div>
        </div>
        <Histogram buckets={DEMO_BUCKETS} market={DEMO_MARKET.yes} consensus={DEMO_CONSENSUS} className="mt-4" barClass="h-16" />
        <div className="mt-3 flex items-center justify-between text-[11px] text-ink-3">
          <span className="lv-mono">{DEMO_PARTICIPANTS} forecasts · mean</span>
          <Illustrative />
        </div>
      </div>
    </div>
  );
}

function DebatePanel() {
  return (
    <div className="lv-panel overflow-hidden">
      <div className="lv-panel-head">
        <span className="lv-label flex items-center gap-2">
          <IconSparkles className="h-3 w-3 text-violet-300" /> AI debate
        </span>
        <Illustrative />
      </div>
      <div className="grid grid-cols-2 divide-x divide-line/70">
        <div className="p-3">
          <p className="lv-mono text-[10px] font-semibold text-emerald-300">YES THESIS</p>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-2">Sustained demand could carry the close past the line.</p>
          <span className="lv-mono mt-2 inline-block rounded border border-line px-1.5 py-0.5 text-[9px] text-ink-3">Source A</span>
        </div>
        <div className="p-3">
          <p className="lv-mono text-[10px] font-semibold text-rose-300">NO THESIS</p>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-2">Quarter-end volatility leaves the threshold uncertain.</p>
          <span className="lv-mono mt-2 inline-block rounded border border-line px-1.5 py-0.5 text-[9px] text-ink-3">Source B</span>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-violet-500/20 bg-violet-500/[0.05] px-3 py-2 text-[10.5px] text-violet-100/90">
        <span className="lv-mono font-semibold text-violet-200">REFEREE</span>
        <span className="text-ink-3">2 assumptions · 1 conflict · no winner picked</span>
      </div>
    </div>
  );
}

function ExecutionPanel() {
  return (
    <div className="lv-panel overflow-hidden">
      <div className="lv-panel-head">
        <span className="lv-label flex items-center gap-2">
          <IconWallet className="h-3 w-3 text-blue-300" /> Execute
        </span>
        <Illustrative />
      </div>
      <div className="space-y-2 p-3.5 text-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-ink-3">Buy YES</span>
          <span className="lv-mono text-ink">{SAMPLE_QUOTE.amountUsdc} USDC</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-3">Est. shares · avg</span>
          <span className="lv-mono text-ink-2">
            {SAMPLE_QUOTE.shares} · {SAMPLE_QUOTE.avgPrice}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-3">Fee</span>
          <span className="lv-mono text-ink-2">{SAMPLE_QUOTE.feeUsdc} USDC</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 py-1.5 text-[11px] text-emerald-100">
          <IconShield className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> Pre-sign check passed
        </div>
        <div className="flex h-9 items-center justify-center gap-2 rounded-[10px] text-[12px] font-semibold text-white" style={{ background: "var(--grad-cta)" }}>
          <IconCheck className="h-3.5 w-3.5" /> Approve in wallet
        </div>
      </div>
    </div>
  );
}

/**
 * Hero product composition: market intelligence, a Prediction Room with the
 * community distribution, a compact AI debate and a wallet execution card.
 * Static server-rendered markup with illustrative data; inert and hidden from
 * assistive tech (the figcaption says what it is).
 *
 * Desktop (xl+): layered stage with absolute panels. Tablet: two-column grid.
 * Phone: market + room only, overlapped, with execution as a slim card.
 */
export function HeroComposition() {
  return (
    <figure className="relative">
      <figcaption className="sr-only">
        Illustrative product composition with sample data: a market intelligence panel, a Prediction Room comparing the market price with a
        community forecast, an AI debate preview and a wallet execution card. Not live markets, users or outcomes.
      </figcaption>
      {/* Phones: market with the room overlapping it. sm to lg: two offset
          columns (market + debate, room + execution) with the second column
          overlapping the first. xl: the wrappers dissolve (display: contents)
          and each card is placed absolutely. */}
      <div aria-hidden="true" inert className="relative grid gap-3 sm:grid-cols-2 sm:gap-0 xl:block xl:h-[660px]">
        <div className="contents sm:relative sm:z-10 sm:flex sm:flex-col sm:gap-4 xl:contents">
          {/* Market intelligence: the anchor panel */}
          <div className="relative z-10 xl:absolute xl:left-[2%] xl:top-[1%] xl:w-[56%]">
            <MarketPanel />
          </div>
          <div className="relative z-30 hidden sm:block xl:absolute xl:bottom-[0%] xl:left-[0%] xl:w-[50%] lv-float lv-float--slow">
            <DebatePanel />
          </div>
        </div>
        <div className="contents sm:relative sm:z-20 sm:-ml-10 sm:mt-16 sm:flex sm:flex-col sm:gap-4 xl:contents">
          {/* Room: overlaps the market on every layout */}
          <div className="relative z-20 -mt-8 ml-6 sm:mt-0 sm:ml-0 xl:absolute xl:right-[0%] xl:top-[13%] xl:w-[42%] lv-float">
            <RoomPanel />
          </div>
          <div className="relative z-20 hidden sm:ml-14 sm:block xl:ml-0 xl:absolute xl:bottom-[3%] xl:right-[4%] xl:w-[40%]">
            <ExecutionPanel />
          </div>
        </div>
      </div>
    </figure>
  );
}
