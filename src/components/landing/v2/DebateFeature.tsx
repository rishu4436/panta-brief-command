import { IconSparkles } from "../../ui/Icons";
import { Illustrative, Kicker } from "./primitives";

type Claim = { text: string; source: string };
const YES: { thesis: string; claims: Claim[]; assumptions: string[]; weaken: string } = {
  thesis: "Demand has been steady enough that a close above the line is plausible.",
  claims: [
    { text: "Recent on-chain activity has trended upward.", source: "Source A" },
    { text: "Market flow leans YES over the sampled window.", source: "Market data" },
  ],
  assumptions: ["The trend holds into quarter-end"],
  weaken: "A sharp drawdown in the final weeks.",
};
const NO: typeof YES = {
  thesis: "The threshold sits far enough away that quarter-end volatility dominates.",
  claims: [
    { text: "Similar thresholds were missed in earlier quarters.", source: "Source B" },
    { text: "One wallet accounts for a large share of YES flow.", source: "Market data" },
  ],
  assumptions: ["Volatility stays near recent levels"],
  weaken: "Sustained buying well above the line.",
};

function Side({ side, data }: { side: "yes" | "no"; data: typeof YES }) {
  const yes = side === "yes";
  return (
    <div className={`lv-panel lv-panel--flat flex h-full flex-col p-5 sm:p-6 ${yes ? "!border-emerald-400/20" : "!border-rose-400/20"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`lv-mono text-[12px] font-semibold tracking-[0.14em] ${yes ? "text-emerald-300" : "text-rose-300"}`}>{yes ? "YES" : "NO"} THESIS</p>
        <span className="lv-mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">Evidence: limited</span>
      </div>
      <p className="mt-3 text-[15px] leading-snug text-ink">{data.thesis}</p>
      <ol className="mt-5 space-y-2.5">
        {data.claims.map((c, i) => (
          <li key={c.text} className="rounded-lg border border-line/70 bg-inset/60 p-3">
            <p className="text-[12.5px] leading-snug text-ink-2">
              <span className="lv-mono mr-1.5 text-ink-3">C{i + 1}</span>
              {c.text}
            </p>
            <span className="lv-mono mt-2 inline-flex rounded border border-line px-1.5 py-0.5 text-[9.5px] text-ink-3">{c.source} · illustrative</span>
          </li>
        ))}
      </ol>
      <div className="mt-auto space-y-2 pt-5 text-[12px] text-ink-3">
        <p>
          <span className="lv-label mr-2">Assumes</span>
          {data.assumptions[0]}
        </p>
        <p>
          <span className="lv-label mr-2">Weakened by</span>
          {data.weaken}
        </p>
      </div>
    </div>
  );
}

function Referee() {
  const rows = [
    ["Supporting", "C1 (YES) and market flow agree on direction.", "text-emerald-200"],
    ["Conflicting", "C2 (YES) and C2 (NO) read the same flow differently.", "text-rose-200"],
    ["Quality", "Moderate · one source is dated.", "text-amber-200"],
    ["Missing", "No order-book depth; no scheduled catalysts.", "text-ink-2"],
  ] as const;
  return (
    <div className="lv-panel flex h-full flex-col !border-violet-500/30 p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "var(--grad-ai)" }} aria-hidden="true" />
      <p className="lv-mono flex items-center gap-2 text-[12px] font-semibold tracking-[0.14em] text-violet-200">
        <IconSparkles className="h-3.5 w-3.5" /> EVIDENCE REFEREE
      </p>
      <p className="mt-3 text-[13px] leading-snug text-ink-2">Audits both cases. It never picks a winner.</p>
      <dl className="mt-5 space-y-3 md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-3 md:space-y-0 lg:block lg:space-y-3">
        {rows.map(([k, v, c]) => (
          <div key={k} className="border-l border-violet-400/30 pl-3">
            <dt className={`lv-label !text-[9.5px] ${c}`}>{k}</dt>
            <dd className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto pt-5">
        <div className="rounded-lg border border-line bg-inset/70 p-3 text-[12px]">
          <p className="lv-label !text-[9.5px]">Community challenge · open</p>
          <p className="mt-1 leading-snug text-ink-2">&ldquo;Source B covers a different threshold.&rdquo; — on NO · C1</p>
        </div>
      </div>
    </div>
  );
}

/** Phones: one condensed card. One claim per side, then the referee summary. */
function CompactDebate() {
  const sides = [
    { key: "YES", data: YES, cls: "text-emerald-300", bar: "bg-emerald-400/70" },
    { key: "NO", data: NO, cls: "text-rose-300", bar: "bg-rose-400/70" },
  ] as const;
  const summary = [
    ["Supporting", "C1 and market flow agree", "text-emerald-200"],
    ["Conflicting", "Both read the same flow", "text-rose-200"],
    ["Quality", "Moderate · one dated source", "text-amber-200"],
    ["Missing", "Order-book depth, catalysts", "text-ink-2"],
  ] as const;
  return (
    <div className="lv-panel overflow-hidden">
      <div className="lv-panel-head">
        <span className="lv-label flex items-center gap-2">
          <IconSparkles className="h-3 w-3 text-violet-300" /> AI debate
        </span>
        <Illustrative>Placeholder sources</Illustrative>
      </div>
      <div className="divide-y divide-line/70">
        {sides.map(({ key, data, cls, bar }) => (
          <div key={key} className="relative py-3.5 pl-5 pr-4">
            <span className={`absolute bottom-3.5 left-0 top-3.5 w-[3px] rounded-r ${bar}`} aria-hidden="true" />
            <p className={`lv-mono text-[11px] font-semibold tracking-[0.14em] ${cls}`}>{key} THESIS</p>
            <p className="mt-1 text-[14px] leading-snug text-ink">{data.thesis}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-snug text-ink-3">
              <span className="text-ink-2">{data.claims[0].text}</span>
              <span className="lv-mono rounded border border-line px-1.5 py-0.5 text-[9.5px]">{data.claims[0].source} · illustrative</span>
            </p>
          </div>
        ))}
      </div>
      <div className="border-t border-violet-500/25 bg-violet-500/[0.05] px-4 py-3.5">
        <p className="lv-mono flex items-center justify-between gap-2 text-[11px] font-semibold tracking-[0.14em] text-violet-200">
          <span>EVIDENCE REFEREE</span>
          <span className="font-normal tracking-normal text-ink-3">no winner picked</span>
        </p>
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
          {summary.map(([k, v, c]) => (
            <div key={k}>
              <dt className={`lv-label !text-[9.5px] ${c}`}>{k}</dt>
              <dd className="mt-0.5 text-[12px] leading-snug text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-line/60 pt-2.5 text-[12px] leading-snug text-ink-3">
          <span className="lv-label !text-[9.5px] mr-1.5">Challenge · open</span>
          &ldquo;Source B covers a different threshold.&rdquo;
        </p>
      </div>
    </div>
  );
}

/** F. AI Debate. */
export function DebateFeature() {
  return (
    <section id="debate" aria-labelledby="debate-title" className="relative scroll-mt-20 overflow-hidden py-14 sm:py-20 lg:py-28">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{ background: "radial-gradient(30% 40% at 50% 55%, rgba(139,92,246,0.12), transparent 70%)" }}
      />
      <div className="mx-auto max-w-[1360px] px-5 sm:px-8">
        <div className="lv-reveal mx-auto max-w-3xl text-center">
          <Kicker index="04" className="justify-center">
            AI Debate Arena
          </Kicker>
          <h2 id="debate-title" className="lv-h2 mt-4 sm:mt-5">
            Two sides. Real evidence. <span className="lv-accent text-violet-200">Better questions.</span>
          </h2>
          <p className="lv-lede mx-auto mt-4 sm:mt-6 max-w-2xl">
            The strongest sourced case for YES and for NO, each claim tied to its source, with assumptions and uncertainty stated. An Evidence
            Referee audits both, and the community can challenge any claim.
          </p>
        </div>

        <figure className="lv-reveal relative mt-8 sm:mt-14">
          <figcaption className="sr-only">
            Illustrative debate layout with placeholder sources: a YES thesis, a NO thesis and an Evidence Referee panel. Not a real debate.
          </figcaption>
          <div aria-hidden="true" inert className="md:hidden">
            <CompactDebate />
          </div>
          <div className="mb-4 hidden flex-wrap items-center justify-center gap-3 text-[12px] text-ink-3 md:flex" aria-hidden="true">
            <Illustrative>Illustrative · placeholder sources</Illustrative>
          </div>
          <div aria-hidden="true" inert className="hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
            <div className="lg:order-1">
              <Side side="yes" data={YES} />
            </div>
            <div className="md:order-3 md:col-span-2 lg:order-2 lg:col-span-1">
              <Referee />
            </div>
            <div className="md:order-2 lg:order-3">
              <Side side="no" data={NO} />
            </div>
          </div>
        </figure>

        <p className="mx-auto mt-5 max-w-2xl text-center text-[12.5px] leading-relaxed text-ink-3 sm:mt-8 sm:text-[13px]">
          Debates are generated only when an AI provider is available on the server; otherwise the room says so and nothing is simulated. They
          are a research aid, not advice, and no side is declared the winner.
        </p>
      </div>
    </section>
  );
}
