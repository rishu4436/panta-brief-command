import Link from "next/link";
import { BrandMark } from "./BrandMark";

const DISCLAIMER =
  "Prediction markets involve risk. Market data and AI-generated analysis may be incomplete or uncertain. Review all transaction details before approving with your wallet.";

const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "Trading Desk", href: "/desk" },
  { label: "Markets", href: "/desk" },
  { label: "About", href: "/about" },
  { label: "GitHub", href: "https://github.com/rishu4436/panta-brief-command", external: true },
  { label: "Panta docs", href: "https://docs.panta.market/", external: true },
  { label: "Solana", href: "https://solana.com/", external: true },
];

function FooterLink({ label, href, external }: (typeof LINKS)[number]) {
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
            {LINKS.slice(3).map((l) => (
              <FooterLink key={l.label} {...l} />
            ))}
          </nav>
        </div>
      </footer>
    );
  }
  return (
    <footer className="border-t border-line/70">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7" />
            <span className="text-[15px] font-bold tracking-[0.08em] text-ink">BRIEF COMMAND</span>
          </div>
          <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-ink-2">
            An AI-native prediction-market desk built on the Panta API and Solana: discover markets, read the
            evidence, execute with your own wallet, and track what happened.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 [@media(pointer:coarse)]:gap-y-0">
          {LINKS.map((l) => (
            <FooterLink key={l.label} {...l} />
          ))}
        </nav>
      </div>
      <div className="border-t border-line/60">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-5 text-[12px] leading-relaxed text-ink-3 sm:px-6 md:flex-row md:items-center md:justify-between">
          <p className="max-w-3xl">{DISCLAIMER}</p>
          <p className="shrink-0">Built on Panta API · Solana</p>
        </div>
      </div>
    </footer>
  );
}
