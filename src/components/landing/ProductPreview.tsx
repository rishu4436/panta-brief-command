"use client";

import { AiBriefView } from "../AiBrief";
import { BrandMark } from "../BrandMark";
import { MarketListRow } from "../desk/MarketListRow";
import { ProbabilityPanel } from "../desk/ProbabilityPanel";
import { PhaseBadge } from "../PhaseBadge";
import { TapeSparkline } from "../TapeSparkline";
import { IconSearch } from "../ui/Icons";
import { ScaledCanvas } from "./ScaledCanvas";
import { TicketPreview } from "./TicketPreview";
import { SAMPLE_BRIEF, SAMPLE_ENDS_LABEL, SAMPLE_MARKET, SAMPLE_RESOLVES_LABEL, SAMPLE_ROWS, SAMPLE_TAPE } from "./sample";

const DESK_W = 1280;
const DESK_H = 900;
const MOBILE_W = 390;
const MOBILE_H = 600;

function IllustrativeBadge() {
  return (
    <span className="whitespace-nowrap rounded-md border border-amber-400/50 bg-amber-400/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
      Illustrative preview
    </span>
  );
}

function PreviewTopBar({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={`flex h-16 items-center justify-between gap-3 border-b border-line/80 bg-bg/75 ${mobile ? "px-4" : "px-5"}`}>
      <div className="flex items-center gap-8">
        <span className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <span className={`whitespace-nowrap font-bold tracking-[0.08em] text-ink ${mobile ? "text-[13px]" : "text-[15px]"}`}>BRIEF COMMAND</span>
        </span>
        {!mobile && (
          <span className="flex items-center gap-1">
            {["Markets", "Briefs", "Trade", "Positions", "Activity"].map((l, i) => (
              <span key={l} className={`type-nav relative flex h-16 items-center px-3 ${i === 0 ? "text-ink" : "text-ink-2"}`}>
                {l}
                {i === 0 && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-cyan-400" />}
              </span>
            ))}
          </span>
        )}
      </div>
      <IllustrativeBadge />
    </div>
  );
}

function MarketHeader() {
  return (
    <header>
      <span className="type-back inline-flex min-h-8 items-center">← Markets</span>
      <p className="type-display mt-1">{SAMPLE_MARKET.title}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PhaseBadge phase={SAMPLE_MARKET.phase} />
        <span className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-3">Crypto</span>
        <span className="type-meta font-num">Sample data · not a live market</span>
      </div>
    </header>
  );
}

function Probability() {
  return (
    <ProbabilityPanel
      yes={SAMPLE_MARKET.yesPrice}
      no={SAMPLE_MARKET.noPrice}
      volume="1,240.50 USDC"
      ends={SAMPLE_ENDS_LABEL}
      resolves={SAMPLE_RESOLVES_LABEL}
      prints={SAMPLE_TAPE.length}
    />
  );
}

/** The real market-workspace layout (sidebar · market · brief) with sample data. */
function DeskCanvas() {
  return (
    <div className="h-full bg-bg">
      <PreviewTopBar />
      <div className="grid grid-cols-[232px_minmax(0,1fr)_372px] gap-4 p-5">
        <nav className="card flex flex-col overflow-hidden self-start">
          <div className="border-b border-line p-3">
            <h2 className="text-[13px] font-semibold text-ink">Markets</h2>
            <div className="field mt-2 flex !min-h-9 items-center gap-2 text-[13px] text-ink-3">
              <IconSearch className="h-3.5 w-3.5" /> Search markets…
            </div>
            <div className="mt-2 flex gap-1.5">
              <span className="chip" aria-pressed="true">Open</span>
              <span className="chip">All phases</span>
            </div>
          </div>
          <div className="space-y-1 p-2">
            {SAMPLE_ROWS.map((r, i) => (
              <MarketListRow key={r.id} title={r.title} yesLabel={`${r.yes}%`} noLabel={`${100 - r.yes}%`} phase={r.phase} active={i === 0} />
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-4">
          <MarketHeader />
          <Probability />
          <TapeSparkline items={SAMPLE_TAPE} size="md" />
          <TicketPreview state="quote_ready" stepper={false} />
        </div>
        <div className="min-w-0">
          <AiBriefView brief={SAMPLE_BRIEF} mode="desk" />
        </div>
      </div>
    </div>
  );
}

/** The mobile market page order: market → probability → activity. */
function MobileCanvas() {
  return (
    <div className="h-full bg-bg">
      <PreviewTopBar mobile />
      <div className="space-y-4 p-4">
        <MarketHeader />
        <Probability />
        <TapeSparkline items={SAMPLE_TAPE} size="md" />
      </div>
    </div>
  );
}

/**
 * Hero product preview. It is built from the desk's own components
 * (MarketListRow, ProbabilityPanel, TapeSparkline, AiBriefView, the trade
 * ticket parts and TradeStateNotice) rendered at desk size and scaled down,
 * fed with SAMPLE data that is labelled as such. The canvas is inert and
 * hidden from assistive tech so sample numbers are never read as live.
 */
export function ProductPreview({ className = "" }: { className?: string }) {
  return (
    <figure className={`relative ${className}`}>
      <figcaption className="sr-only">
        Illustrative preview of the Brief Command desk using sample data, not live markets.
      </figcaption>
      <div className="surface-preview relative overflow-hidden p-1.5 sm:p-2" aria-hidden="true" inert>
        <div className="hidden overflow-hidden rounded-[14px] sm:block">
          <ScaledCanvas width={DESK_W} height={DESK_H}>
            <DeskCanvas />
          </ScaledCanvas>
        </div>
        <div className="overflow-hidden rounded-[14px] sm:hidden">
          <ScaledCanvas width={MOBILE_W} height={MOBILE_H}>
            <MobileCanvas />
          </ScaledCanvas>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg to-transparent" />
      </div>
      <p className="mt-2 text-center text-[12px] text-ink-3" aria-hidden="true">
        Illustrative preview · sample data, not live markets · built from the desk&apos;s own components
      </p>
    </figure>
  );
}
