import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { UsageConsent } from "./UsageConsent";

const DISCLAIMER =
  "Prediction markets involve risk. Market data and AI-generated analysis may be incomplete or uncertain. Review all transaction details before approving with your wallet.";

type FooterLinkSpec = { label: string; href: string; external?: boolean };

const EXTERNAL: FooterLinkSpec[] = [
  { label: "GitHub", href: "https://github.com/rishu4436/panta-brief-command", external: true },
  { label: "Panta docs", href: "https://docs.panta.market/", external: true },
  { label: "Solana", href: "https://solana.com/", external: true },
];

const COLUMNS: { title: string; links: FooterLinkSpec[] }[] = [
  {
    title: "Markets",
    links: [
      { label: "Trading Desk", href: "/desk" },
      { label: "Trade", href: "/execute" },
      { label: "Book", href: "/book?tab=positions" },
      { label: "Create Market", href: "/create" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Prediction Rooms", href: "/rooms" },
      { label: "Arena", href: "/arena" },
      { label: "Creator Studio", href: "/studio" },
    ],
  },
  { title: "Project", links: [{ label: "About", href: "/about" }, ...EXTERNAL] },
];

function FooterLink({ label, href, external }: FooterLinkSpec) {
  const cls = "tap-target text-[13px] text-ink-2 transition hover:text-ink";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {label}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}

export function Footer({ variant = "marketing" }: { variant?: "marketing" | "app" }) {
  if (variant === "app") {
    return (
      <footer className="mt-8 border-t border-line/70">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-5 text-[12px] text-ink-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <p className="max-w-3xl leading-relaxed">{DISCLAIMER}</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
            {EXTERNAL.map((l) => (
              <FooterLink key={l.label} {...l} />
            ))}
          </nav>
        </div>
        <div className="mx-auto max-w-[1600px] px-4 pb-4 sm:px-6">
          <UsageConsent />
        </div>
      </footer>
    );
  }
  return (
    <footer className="border-t border-line/70">
      <div className="mx-auto grid max-w-[1360px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.1fr_1.4fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7" />
            <span className="text-[15px] font-bold tracking-[0.08em] text-ink">BRIEF COMMAND</span>
          </div>
          <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-ink-2">
            A prediction-market platform for intelligence, forecasting, community and execution, built on the Panta API and Solana.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{col.title}</p>
              <ul className="mt-3 flex flex-col gap-2 [@media(pointer:coarse)]:gap-0">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <FooterLink {...l} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-line/60">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-2 px-5 py-5 text-[12px] leading-relaxed text-ink-3 sm:px-8 md:flex-row md:items-center md:justify-between">
          <p className="max-w-3xl">{DISCLAIMER}</p>
          <p className="shrink-0">Built on Panta API · Solana</p>
        </div>
        <div className="mx-auto max-w-[1360px] px-5 pb-5 sm:px-8">
          <UsageConsent />
        </div>
      </div>
    </footer>
  );
}
