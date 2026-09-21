import Link from "next/link";
import { LiveStrip } from "@/components/LiveStrip";

const props = [
  {
    title: "Live catalog",
    body: "Browse Panta USDC markets with phase, volume, and probability bars — no mock tape.",
  },
  {
    title: "AI desk brief",
    body: "One-click narrative from real detail prices and trade prints. Templated by default; OpenAI when keyed.",
  },
  {
    title: "Primary execute",
    body: "One-shot Quote → Sign → Submit → Verify → Attribute. Wallet adapter + server-side API key proxy.",
  },
  {
    title: "Book & activity",
    body: "Positions from GET /positions plus attributed fills from GET /account/trades/ — buys and claims.",
  },
];

export default function LandingPage() {
  return (
    <div>
      <section className="relative overflow-hidden border-b border-[#1f1f23] pb-10 pt-8 md:pb-14 md:pt-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(34,211,238,0.09),_transparent_50%)]" />
        <div className="pointer-events-none absolute -left-24 top-10 h-56 w-56 rounded-full bg-cyan-400/5 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-48 w-48 rounded-full bg-emerald-400/5 blur-3xl" />

        <div className="relative mx-auto max-w-3xl text-center">
          <div className="stage-in stage-delay-1 mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-3 py-1 text-[11px] text-cyan-200/90">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Solana prediction desk · Powered by Panta
          </div>
          <h1 className="stage-in stage-delay-2 text-[2.5rem] font-semibold tracking-tight text-zinc-50 md:text-5xl md:leading-[1.08]">
            Trade the market.
            <br />
            <span className="bg-gradient-to-r from-cyan-300 to-emerald-300 bg-clip-text text-transparent">
              Brief the edge.
            </span>
          </h1>
          <p className="stage-in stage-delay-3 mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-400">
            Terminal-density desk for Panta USDC markets — live odds, AI briefs,
            primary buys, and claims. Operators only. No demos.
          </p>
          <p className="stage-in stage-delay-4 mt-3 flex flex-wrap items-center justify-center gap-2 text-[12px] text-zinc-500">
            <Link
              href="/desk"
              className="text-zinc-300 transition hover:text-cyan-400"
            >
              Intel
            </Link>
            <span className="text-zinc-700">→</span>
            <Link
              href="/execute"
              className="text-zinc-300 transition hover:text-cyan-400"
            >
              Execute
            </Link>
            <span className="text-zinc-700">→</span>
            <Link
              href="/book"
              className="text-zinc-300 transition hover:text-cyan-400"
            >
              Book
            </Link>
            <span className="mx-1 text-zinc-700">·</span>
            <span className="font-num text-[10px] text-zinc-600">⌘K jump</span>
          </p>
          <div className="stage-in stage-delay-5 mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/desk"
              className="inline-flex items-center rounded-md bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-[#0a0a0b] shadow-lg shadow-cyan-400/20 transition hover:bg-cyan-300 active:scale-[0.98]"
            >
              Open live desk →
            </Link>
            <a
              href="https://docs.panta.market/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-[#1f1f23] bg-[#111113] px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-[#2a2a2e] hover:text-zinc-100 active:scale-[0.98]"
            >
              API docs
            </a>
          </div>

          {/* Wallet proof strip — connect lives in header + desk */}
          <div className="stage-in stage-delay-6 mx-auto mt-5 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-[#1f1f23] bg-[#111113]/80 px-4 py-2 text-[11px] text-zinc-500">
            <span className="text-zinc-400">Connect in desk</span>
            <span className="text-zinc-700">·</span>
            <span>Phantom / Solflare</span>
            <span className="text-zinc-700">→</span>
            <span>Quote → Attribute</span>
            <span className="text-zinc-700">→</span>
            <Link href="/book" className="text-cyan-400/90 hover:underline">
              Activity ledger
            </Link>
          </div>
        </div>

        <div className="stage-in stage-delay-7">
          <LiveStrip />
        </div>
      </section>

      <section className="stage-in stage-delay-8 py-10 md:py-12">
        <div className="mb-6 text-center">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
            Built like a desk, not a blog
          </h2>
          <p className="mt-1.5 text-sm text-zinc-400">
            Dense rows. Sticky tickets. Live API only.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {props.map((p) => (
            <div
              key={p.title}
              className="rounded-lg border border-[#1f1f23] bg-[#111113] p-4 transition hover:border-[#2a2a2e]"
            >
              <h3 className="text-[13px] font-semibold text-zinc-100">
                {p.title}
              </h3>
              <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="stage-in stage-delay-8 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1f1f23] bg-[#111113] px-5 py-4">
        <div>
          <div className="text-[13px] font-medium text-zinc-100">
            Set{" "}
            <code className="font-num text-cyan-400/90">PANTA_API_KEY</code> ·
            no sandbox
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Powered by Panta · live catalog only
          </p>
        </div>
        <Link
          href="/desk"
          className="inline-flex items-center rounded-md bg-cyan-400 px-4 py-2 text-[13px] font-semibold text-[#0a0a0b] transition hover:bg-cyan-300 active:scale-[0.98]"
        >
          Enter desk →
        </Link>
      </section>
    </div>
  );
}
