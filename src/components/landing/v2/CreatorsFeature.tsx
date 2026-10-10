import Link from "next/link";
import { IconArrowRight } from "../../ui/Icons";
import { DEMO_BUCKETS, DEMO_CONSENSUS, DEMO_MARKET, DEMO_PARTICIPANTS } from "./demo";
import { Histogram, Illustrative, Kicker, WindowDots } from "./primitives";

/** An outside website (placeholder domain) with the read-only room widget embedded. */
function ExternalSite() {
  return (
    <div className="lv-panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5">
        <WindowDots />
        <span className="lv-mono flex-1 truncate rounded-md border border-line/70 bg-inset px-2.5 py-1 text-[10.5px] text-ink-3">your-newsletter.example/quarter-preview</span>
      </div>
      <div className="grid gap-5 p-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] sm:p-6">
        <div className="hidden space-y-2.5 sm:block" aria-hidden="true">
          <span className="block h-2 w-14 rounded bg-cyan-400/40" />
          <span className="block h-4 w-11/12 rounded bg-ink/80" />
          <span className="block h-4 w-3/4 rounded bg-ink/80" />
          <span className="mt-4 block h-2 w-full rounded bg-ink-3/25" />
          <span className="block h-2 w-full rounded bg-ink-3/25" />
          <span className="block h-2 w-5/6 rounded bg-ink-3/25" />
          <span className="hidden h-2 w-full rounded bg-ink-3/25 sm:block" />
          <span className="hidden h-2 w-2/3 rounded bg-ink-3/25 sm:block" />
          <span className="mt-4 hidden h-2 w-full rounded bg-ink-3/20 sm:block" />
          <span className="hidden h-2 w-4/5 rounded bg-ink-3/20 sm:block" />
        </div>
        {/* The embed widget */}
        <div className="rounded-xl border border-cyan-400/25 bg-bg p-3.5 shadow-[0_20px_60px_-25px_rgba(18,214,245,0.35)]">
          <div className="flex items-center justify-between">
            <p className="lv-label !text-[9px]">Prediction Room · embed</p>
            <span className="lv-mono text-[9px] text-ink-3">read-only</span>
          </div>
          <p className="mt-2 text-[13px] font-semibold leading-snug text-ink">{DEMO_MARKET.title}</p>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="lv-label !text-[9px] !text-emerald-200/80">Community</p>
              <p className="lv-mono text-[24px] font-semibold leading-none text-emerald-200">{DEMO_CONSENSUS}%</p>
            </div>
            <p className="lv-mono text-right text-[10px] leading-tight text-ink-3">
              Market {DEMO_MARKET.yes}%
              <br />
              {DEMO_PARTICIPANTS} forecasts
            </p>
          </div>
          <Histogram buckets={DEMO_BUCKETS} consensus={DEMO_CONSENSUS} className="mt-3" barClass="h-8 sm:h-10" />
          <p className="mt-3 rounded-md border border-line py-1.5 text-center text-[11px] font-medium text-ink-2">Forecast on Brief Command →</p>
        </div>
      </div>
    </div>
  );
}

const DAILY = [2, 3, 1, 4, 6, 3, 5, 7, 4, 8, 6, 9, 5, 7];
const SOURCES = [
  ["Direct / unknown", 46],
  ["Embed widget link", 31],
  ["Elsewhere on Brief Command", 15],
  ["Campaign links", 8],
] as const;

function StudioDashboard() {
  const max = Math.max(...DAILY);
  return (
    <div className="lv-panel overflow-hidden">
      <div className="lv-panel-head">
        <span className="lv-label"><span className="hidden sm:inline">Creator </span>Studio · overview</span>
        <Illustrative>Illustrative metrics</Illustrative>
      </div>
      <div className="grid grid-cols-3 divide-x divide-line/70 border-b border-line/70">
        {[
          ["Forecasting wallets", String(DEMO_PARTICIPANTS)],
          ["Returning", "12"],
          ["Revisions", "61"],
        ].map(([k, v]) => (
          <div key={k} className="px-3 py-3 sm:px-4 sm:py-3.5">
            <p className="lv-label !text-[9px] !tracking-[0.1em]">{k}</p>
            <p className="lv-mono mt-1 text-[19px] sm:text-[22px] font-semibold leading-none text-ink">{v}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 p-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:p-5">
        <div className="hidden sm:block">
          <p className="lv-label !text-[9.5px]">New forecasting wallets / day</p>
          <div className="mt-3 flex h-20 items-end gap-[3px]">
            {DAILY.map((n, i) => (
              <span key={i} className="flex-1 rounded-t-[2px] bg-gradient-to-t from-violet-500/40 to-cyan-400/80" style={{ height: `${(n / max) * 100}%` }} />
            ))}
          </div>
        </div>
        <div>
          <p className="lv-label !text-[9.5px]">Where visitors come from</p>
          <ul className="mt-2.5 space-y-1.5 sm:mt-3 sm:space-y-2">
            {SOURCES.map(([k, v]) => (
              <li key={k} className="text-[11px]">
                <div className="flex justify-between text-ink-3">
                  <span className="truncate">{k}</span>
                  <span className="lv-mono">{v}%</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-line/70">
                  <span className="block h-full rounded-full bg-cyan-300/70" style={{ width: `${v}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="border-t border-line/70 px-4 py-2.5 text-[11px] text-ink-3 sm:px-5">
        <span className="lv-label !text-[9px] mr-2 !text-violet-200/80">Insight</span>
        Embed visitors forecast more often than direct visitors this week.
      </p>
    </div>
  );
}

/** Ties the embed to the Studio: widget visits arrive as a traffic source. */
function Connector() {
  return (
    <div className="flex items-center gap-3 py-2.5 lg:h-16 lg:py-0" aria-hidden="true">
      <span className="ml-6 h-6 w-px bg-gradient-to-b from-cyan-400/60 to-violet-400/60 lg:ml-0 lg:h-px lg:w-8 lg:bg-gradient-to-r" />
      <span className="lv-mono rounded-full border border-cyan-400/25 bg-cyan-400/[0.06] px-2.5 py-1 text-[10.5px] text-cyan-100/90">
        Embed visits &amp; forecasts → Studio
      </span>
    </div>
  );
}

/** G. Creators: Market Everywhere + Creator Growth Studio. */
export function CreatorsFeature() {
  return (
    <section id="creators" aria-labelledby="creators-title" className="relative scroll-mt-20 overflow-hidden border-t border-line/60 py-14 sm:py-20 lg:py-28">
      <div className="lv-grid lv-grid--fade pointer-events-none absolute inset-0 -z-10 opacity-70" aria-hidden="true" />
      <div className="mx-auto max-w-[1360px] px-5 sm:px-8">
        <div className="lv-reveal grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <div>
            <Kicker index="05">For creators</Kicker>
            <h2 id="creators-title" className="lv-h2 mt-4 sm:mt-5">
              Build your own <span className="lv-accent text-cyan-200">prediction community.</span>
            </h2>
          </div>
          <p className="lv-lede max-w-md lg:justify-self-end">
            Open a room, put its live community forecast wherever your audience already reads, and see what brings people back.
          </p>
        </div>

        <figure className="lv-reveal relative mt-8 sm:mt-14">
          <figcaption className="sr-only">
            Illustrative composition: an outside website with an embedded read-only room widget, and a Creator Studio overview with example
            metrics.
          </figcaption>
          <div aria-hidden="true" inert className="grid items-start lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-6">
            <ExternalSite />
            <div>
              <Connector />
              <StudioDashboard />
            </div>
          </div>
        </figure>

        <div className="mt-7 grid gap-6 sm:mt-14 md:grid-cols-2 md:gap-14">
          <div className="lv-reveal">
            <h3 className="lv-h3">Market Everywhere</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2 sm:mt-3 sm:text-[15px]">
              Read-only widgets for any website: the room&apos;s consensus, its distribution and the market line, with no wallet, cookies or
              scripts. An embed generator, theme and layout options, and clean share links for every room.
            </p>
          </div>
          <div className="lv-reveal">
            <h3 className="lv-h3">Creator Growth Studio</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2 sm:mt-3 sm:text-[15px]">
              Manage your rooms and follow participation: forecasting wallets, returning forecasters, revisions, traffic sources, campaign links
              and rule-based insights. Wallet counts are wallets, not people.
            </p>
          </div>
        </div>
        <Link href="/studio" className="btn btn-primary btn-lg group mt-7 sm:mt-10">
          Open Creator Studio <IconArrowRight className="icon-nudge h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
