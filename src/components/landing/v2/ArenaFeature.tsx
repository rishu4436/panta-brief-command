import Link from "next/link";
import { IconArrowRight } from "../../ui/Icons";
import { DEMO_LEADERBOARD, type DemoForecaster } from "./demo";
import { Illustrative, Kicker } from "./primitives";

function Trend({ values, muted = false }: { values: number[]; muted?: boolean }) {
  const w = 64;
  const h = 20;
  const min = Math.min(...values) - 2;
  const max = Math.max(...values) + 2;
  const step = w / Math.max(1, values.length - 1);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - ((v - min) / (max - min)) * h).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-5 w-16" aria-hidden="true">
      <path d={d} fill="none" stroke={muted ? "#8090a7" : "#20d6a1"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Row({ f, rank }: { f: DemoForecaster; rank: number | null }) {
  const top = rank === 1;
  return (
    <li className={`grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 sm:py-3 sm:grid-cols-[2.75rem_minmax(0,1fr)_4.5rem_4.5rem_4rem_4.5rem] sm:px-5 ${top ? "bg-cyan-400/[0.04]" : ""}`}>
      <span className={`lv-mono text-[15px] font-semibold ${top ? "text-cyan-200" : rank ? "text-ink-2" : "text-ink-3"}`}>{rank ? `#${rank}` : "—"}</span>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${top ? "border-cyan-300/60 text-cyan-100" : "border-line-strong text-ink-3"}`}>
          {f.id.slice(-2)}
        </span>
        <span className="truncate text-[13.5px] text-ink">{f.id}</span>
      </span>
      <span className={`lv-mono text-right text-[16px] font-semibold ${rank ? "text-ink" : "text-ink-2"}`}>{f.score.toFixed(1)}</span>
      <span className="lv-mono hidden text-right text-[12.5px] text-ink-3 sm:block">{f.brier}</span>
      <span className="lv-mono hidden text-right text-[12.5px] text-ink-3 sm:block">{f.scored}</span>
      <span className="hidden justify-end sm:flex">
        <Trend values={f.trend} muted={!rank} />
      </span>
    </li>
  );
}

function Leaderboard() {
  const ranked = DEMO_LEADERBOARD.filter((f) => f.tier === "ranked");
  const provisional = DEMO_LEADERBOARD.filter((f) => f.tier === "provisional");
  return (
    <figure className="relative">
      <figcaption className="sr-only">
        Illustrative leaderboard with numbered placeholder forecasters and example scores: four ranked forecasters and one provisional
        forecaster who has not yet reached the ranking threshold.
      </figcaption>
      <div aria-hidden="true" inert className="lv-panel overflow-hidden">
        <div className="lv-panel-head flex-wrap !px-5 !py-3">
          <span className="flex items-center gap-1 rounded-lg border border-line bg-inset p-0.5 text-[12px]">
            <span className="rounded-md bg-elevated px-2.5 py-1 text-ink">Global</span>
            <span className="px-2.5 py-1 text-ink-3">This room</span>
          </span>
          <Illustrative>Illustrative scores</Illustrative>
        </div>
        <div className="lv-label hidden grid-cols-[2.75rem_minmax(0,1fr)_4.5rem_4.5rem_4rem_4.5rem] gap-x-3 border-b border-line/70 px-5 py-2 sm:grid">
          <span>Rank</span>
          <span>Forecaster</span>
          <span className="text-right">Score</span>
          <span className="text-right">Brier</span>
          <span className="text-right">Scored</span>
          <span className="text-right">Trend</span>
        </div>
        <p className="lv-mono flex items-center justify-between bg-inset/60 px-5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-3">
          <span className="text-cyan-200/90">Ranked</span>
          <span>5+ verified markets</span>
        </p>
        <ol className="divide-y divide-line/60">
          {ranked.map((f, i) => (
            <Row key={f.id} f={f} rank={i + 1} />
          ))}
        </ol>
        <p className="lv-mono flex items-center justify-between border-t border-line/70 bg-inset/60 px-5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-3">
          <span className="text-amber-200/90">Provisional</span>
          <span>Not ranked yet</span>
        </p>
        <ol>
          {provisional.map((f) => (
            <Row key={f.id} f={f} rank={null} />
          ))}
        </ol>
      </div>
    </figure>
  );
}

const LIFECYCLE = ["Forecast", "Market resolves", "Outcome verified", "Scored"];

/** E. Arena. */
export function ArenaFeature() {
  return (
    <section id="arena" aria-labelledby="arena-title" className="relative scroll-mt-20 border-y border-line/60 bg-[linear-gradient(180deg,rgba(11,18,32,0.55),rgba(5,9,20,0))] py-14 sm:py-20 lg:py-28">
      <div className="mx-auto grid max-w-[1360px] gap-8 px-5 sm:gap-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
        <div className="lv-reveal">
          <Kicker index="03">Forecasting Arena</Kicker>
          <h2 id="arena-title" className="lv-h2 mt-4 sm:mt-5">
            Build a track record, <span className="lv-accent text-cyan-200">not just an opinion.</span>
          </h2>
          <p className="lv-lede mt-4 sm:mt-6">
            Forecasts are scored for calibration with the Brier rule, only after a market&apos;s outcome is verified by Panta and on-chain. No
            trading profits, no rewards.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 sm:mt-8 sm:gap-x-6">
            {[
              ["Ranked vs provisional", "Ranking starts at five scored markets: no ranking on one lucky call."],
              ["Global and room boards", "One global record, plus a board in every room."],
              ["Public profiles", "Scored markets and pending forecasts per forecaster."],
              ["A record that holds", "Your last revision before the cutoff counts; final scores never change."],
            ].map(([t, d]) => (
              <li key={t} className="border-l border-line-strong pl-3 sm:pl-4">
                <p className="text-[13.5px] font-semibold leading-snug text-ink sm:text-[14px]">{t}</p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-3 sm:text-[13.5px]">{d}</p>
              </li>
            ))}
          </ul>
          <Link href="/arena" className="btn btn-primary btn-lg group mt-6 sm:mt-9">
            Explore the Arena <IconArrowRight className="icon-nudge h-4 w-4" />
          </Link>
        </div>
        <div className="lv-reveal min-w-0">
          <Leaderboard />
          <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-[12px] text-ink-3" aria-label="When a forecast is scored">
            {LIFECYCLE.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="text-line-strong">
                    →
                  </span>
                )}
                <span className={`lv-mono rounded-full border px-2.5 py-1 text-[11px] ${i === LIFECYCLE.length - 1 ? "border-cyan-400/40 text-cyan-100" : "border-line text-ink-2"}`}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
