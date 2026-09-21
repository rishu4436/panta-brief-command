import Link from "next/link";

const props = [
  {
    title: "Live catalog",
    body: "Browse Panta USDC markets with phase, volume, and Polymarket-style probability bars — no mock tape.",
  },
  {
    title: "AI desk brief",
    body: "One-click narrative from real detail prices and trade prints. Templated by default; OpenAI when keyed.",
  },
  {
    title: "Primary execute",
    body: "Quote → build VT → sign → submit → verify → attribute. Wallet adapter, server-side API key proxy.",
  },
  {
    title: "Book & claims",
    body: "Positions from GET /positions, win and creator-fee claim builds signed in-wallet.",
  },
];

export default function LandingPage() {
  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[#1f1f23] pb-16 pt-10 md:pb-24 md:pt-16">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,211,238,0.06),_transparent_55%)]" />
        <div className="relative mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#1f1f23] bg-[#111113] px-3 py-1 text-[11px] text-zinc-400">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Solana prediction desk · Powered by Panta
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 md:text-5xl md:leading-[1.1]">
            Trade the market.
            <br />
            <span className="text-zinc-500">Brief the edge.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-zinc-500">
            A terminal-density desk for Panta USDC markets — live odds, AI
            briefs, primary buys, and claims. Built for operators, not demos.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/desk"
              className="inline-flex items-center rounded-md bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-cyan-300"
            >
              Open live desk →
            </Link>
            <a
              href="https://docs.panta.market/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-[#1f1f23] bg-[#111113] px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-[#2a2a2e] hover:text-zinc-100"
            >
              API docs
            </a>
          </div>
        </div>

        {/* Mini terminal preview strip */}
        <div className="relative mx-auto mt-14 max-w-4xl overflow-hidden rounded-xl border border-[#1f1f23] bg-[#111113] shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 border-b border-[#1f1f23] px-4 py-2.5">
            <span className="h-2 w-2 rounded-full bg-[#2a2a2e]" />
            <span className="h-2 w-2 rounded-full bg-[#2a2a2e]" />
            <span className="h-2 w-2 rounded-full bg-[#2a2a2e]" />
            <span className="ml-2 font-num text-[10px] text-zinc-600">
              desk · markets
            </span>
          </div>
          <div className="grid divide-y divide-[#1f1f23] md:grid-cols-3 md:divide-x md:divide-y-0">
            {[
              { label: "YES", pct: "62.4%", color: "text-emerald-400", bar: "w-[62%]" },
              { label: "Volume", pct: "184.2k", color: "text-zinc-200", bar: "w-[78%]" },
              { label: "NO", pct: "37.6%", color: "text-rose-400", bar: "w-[38%]" },
            ].map((cell) => (
              <div key={cell.label} className="px-5 py-6">
                <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  {cell.label}
                </div>
                <div className={`mt-1 font-num text-2xl font-semibold ${cell.color}`}>
                  {cell.pct}
                </div>
                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#1f1f23]">
                  <div className={`h-full rounded-full bg-current opacity-60 ${cell.color} ${cell.bar}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="py-14 md:py-20">
        <div className="mb-8 text-center">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
            Built like a desk, not a blog
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            Dense rows. Sticky tickets. Live API only.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {props.map((p) => (
            <div
              key={p.title}
              className="rounded-lg border border-[#1f1f23] bg-[#111113] p-4 transition hover:border-[#2a2a2e]"
            >
              <h3 className="text-[13px] font-semibold text-zinc-100">{p.title}</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="mb-8 rounded-xl border border-[#1f1f23] bg-[#111113] px-6 py-10 text-center md:px-10">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-50">
          Ready for the floor
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
          Set <code className="font-num text-cyan-400/80">PANTA_API_KEY</code> and
          open the desk. No sandbox. No fake markets.
        </p>
        <Link
          href="/desk"
          className="mt-6 inline-flex items-center rounded-md bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-cyan-300"
        >
          Enter desk →
        </Link>
      </section>
    </div>
  );
}
