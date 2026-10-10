import Link from "next/link";
import { IconArrowRight, IconCheck, IconExternal } from "../../ui/Icons";
import { DEMO_BUCKETS, DEMO_CONSENSUS, DEMO_MARKET, DEMO_PARTICIPANTS } from "./demo";
import { Histogram, Illustrative, Kicker, ProbBar, WindowDots } from "./primitives";

const POINTS = [
  ["Creator-owned", "Any wallet can open a room around a live Panta market and own it."],
  ["Free forecasting", "Probability forecasts cost nothing and sign nothing on-chain."],
  ["Consensus & distribution", "The room's mean and the full spread of views, side by side."],
  ["Revision history", "Change your mind while the market is open; every change is kept."],
  ["Share anywhere", "Every room has a clean public link and an embeddable widget."],
] as const;

const REVISIONS = [
  { p: 48, label: "First forecast" },
  { p: 55, label: "Revised" },
  { p: 60, label: "Current" },
];

function RoomPreview() {
  return (
    <figure className="relative">
      <figcaption className="sr-only">
        Illustrative Prediction Room with sample data: the market price from Panta shown separately from the room&apos;s community forecast,
        the distribution of forecasts and one forecaster&apos;s revision history.
      </figcaption>
      <div aria-hidden="true" inert className="lv-panel overflow-hidden">
        <div className="lv-panel-head !py-2.5">
          <span className="flex items-center gap-3">
            <WindowDots />
            <span className="lv-mono hidden text-[11px] text-ink-3 sm:inline">/rooms/sol-quarter-close</span>
          </span>
          <Illustrative />
        </div>
        <div className="p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="lv-label">Prediction Room · {DEMO_MARKET.category}</p>
              <p className="mt-2 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[24px]">SOL quarter-close room</p>
              <p className="mt-1 text-[13px] text-ink-3">Linked market: {DEMO_MARKET.title}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink-2">
              <IconExternal className="h-3.5 w-3.5" /> Share
            </span>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-inset/70 p-4">
              <div className="flex items-center justify-between">
                <p className="lv-label flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rotate-45 bg-ink" /> Market price
                </p>
                <span className="lv-mono text-[10px] text-ink-3">from Panta trades</span>
              </div>
              <p className="lv-mono mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em] text-ink">
                {DEMO_MARKET.yes}
                <span className="text-[20px] text-ink-3">% YES</span>
              </p>
              <ProbBar yes={DEMO_MARKET.yes} className="mt-3" />
            </div>
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.045] p-4">
              <div className="flex items-center justify-between">
                <p className="lv-label flex items-center gap-1.5 !text-emerald-200/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Community forecast
                </p>
                <span className="lv-mono text-[10px] text-emerald-200/70">mean of {DEMO_PARTICIPANTS}</span>
              </div>
              <p className="lv-mono mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em] text-emerald-200">
                {DEMO_CONSENSUS}
                <span className="text-[20px] text-emerald-200/60">% YES</span>
              </p>
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-emerald-400/10">
                <span className="h-full rounded-full bg-emerald-300/80" style={{ width: `${DEMO_CONSENSUS}%` }} />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-line/70 p-4">
              <div className="flex items-center justify-between">
                <p className="lv-label">Distribution of forecasts</p>
                <span className="flex items-center gap-3 text-[10px] text-ink-3">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rotate-45 bg-ink" />
                    Market
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                    Mean
                  </span>
                </span>
              </div>
              <Histogram buckets={DEMO_BUCKETS} market={DEMO_MARKET.yes} consensus={DEMO_CONSENSUS} className="mt-5" barClass="h-24" />
            </div>
            <div className="rounded-xl border border-line/70 p-4">
              <p className="lv-label">Your revisions</p>
              <ol className="mt-3 space-y-2.5">
                {REVISIONS.map((r, i) => (
                  <li key={r.label} className="flex items-center gap-3 text-[12px]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${i === REVISIONS.length - 1 ? "bg-cyan-300" : "border border-ink-3/60"}`} />
                    <span className="flex-1 text-ink-3">{r.label}</span>
                    <span className={`lv-mono ${i === REVISIONS.length - 1 ? "text-ink" : "text-ink-3"}`}>{r.p}%</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 flex items-center gap-1.5 text-[11px] text-emerald-200/90">
                <IconCheck className="h-3.5 w-3.5" /> Free · editable until close
              </p>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** D. Rooms flagship. */
export function RoomsFeature() {
  return (
    <section id="rooms" aria-labelledby="rooms-title" className="relative scroll-mt-20 overflow-hidden py-20 sm:py-28">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{ background: "radial-gradient(40% 45% at 30% 50%, rgba(32,214,161,0.07), transparent 70%), radial-gradient(35% 40% at 75% 30%, rgba(52,120,246,0.08), transparent 70%)" }}
      />
      <div className="mx-auto grid max-w-[1360px] gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-center lg:gap-16">
        <div className="lv-reveal order-2 min-w-0 lg:order-1">
          <RoomPreview />
          <p className="mt-4 max-w-xl text-[12.5px] leading-relaxed text-ink-3">
            Two separate measurements: the market price comes from trading on Panta; the community forecast is the average of free forecasts in
            the room. Neither is official or guaranteed.
          </p>
        </div>
        <div className="lv-reveal order-1 lg:order-2">
          <Kicker index="02">Prediction Rooms</Kicker>
          <h2 id="rooms-title" className="lv-h2 mt-5">
            Every market deserves a <span className="lv-accent text-emerald-200">conversation.</span>
          </h2>
          <p className="lv-lede mt-6">
            Rooms gather people around one live market. Forecast for free, see where the room lands, and watch how views move as the market
            does.
          </p>
          <dl className="mt-8 divide-y divide-line/60 border-y border-line/60">
            {POINTS.map(([t, d]) => (
              <div key={t} className="grid gap-1 py-3.5 sm:grid-cols-[170px_1fr] sm:gap-4">
                <dt className="text-[14px] font-semibold text-ink">{t}</dt>
                <dd className="text-[14px] leading-snug text-ink-3">{d}</dd>
              </div>
            ))}
          </dl>
          <Link href="/rooms" className="btn btn-primary btn-lg group mt-8">
            Discover Rooms <IconArrowRight className="icon-nudge h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
