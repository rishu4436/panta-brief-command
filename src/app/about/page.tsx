import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description: "What Brief Command is, what it does today, and how it handles data, AI and your wallet.",
};

const FACTS: { title: string; body: string }[] = [
  {
    title: "Live data from Panta",
    body: "Market catalog, details, recent trades, positions and attributed trades come from the Panta API through an allowlisted server proxy. The API key stays on the server.",
  },
  {
    title: "Evidence first, then AI",
    body: "Each brief starts from deterministic signals computed from the market and its tape: probability, flow, timing and data quality. An LLM (or a template when no key is set) interprets those signals and never adds buy or sell advice.",
  },
  {
    title: "Your wallet, your approval",
    body: "Primary buys are quoted and built by Panta, checked against an instruction allowlist in the browser, and only then sent to your wallet for approval. Brief Command never holds keys or funds.",
  },
  {
    title: "Honest status",
    body: "On-chain confirmation, Panta verification and attribution are tracked as separate steps, so a trade is never shown as complete before it is.",
  },
];

export default function AboutPage() {
  return (
    <div className="relative overflow-hidden">
      <div className="glow-soft pointer-events-none absolute inset-x-0 top-0 h-[420px]" aria-hidden="true" />
      <div className="relative mx-auto max-w-[960px] px-4 py-16 sm:px-6 sm:py-20">
        <p className="eyebrow">About</p>
        <h1 className="h-section mt-3">A prediction-market workstation on Panta and Solana.</h1>
        <p className="text-lede mt-4 max-w-2xl">
          Brief Command brings market discovery, an evidence-based AI brief, wallet-approved execution and a
          book of positions and claims into one desk. It is an independent project built on the public Panta
          API; it is not operated by Panta.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {FACTS.map((f) => (
            <div key={f.title} className="card p-5">
              <h2 className="h-card">{f.title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/desk" className="btn btn-primary btn-lg">
            Open Trading Desk
          </Link>
          <a
            href="https://github.com/rishu4436/panta-brief-command"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-lg"
          >
            View source on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
