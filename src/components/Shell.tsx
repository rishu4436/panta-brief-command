"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import type { ReactNode } from "react";

const nav = [
  { href: "/", label: "Intel", hint: "Markets · Brief · Tape" },
  { href: "/execute", label: "Execute", hint: "Primary buy desk" },
  { href: "/book", label: "Book", hint: "Positions · Claims" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen text-zinc-100">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 top-0 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -right-24 top-40 h-80 w-80 rounded-full bg-violet-600/25 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(15,23,42,0.2),_rgba(2,6,23,0.95))]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="group flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 text-sm font-black text-slate-950 shadow-lg shadow-cyan-500/30">
                PB
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-wide">
                  Panta Brief Command
                </div>
                <div className="text-[11px] text-zinc-400">
                  Prediction desk · Solana USDC
                </div>
              </div>
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {nav.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/" || pathname.startsWith("/markets")
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-1.5 text-sm transition ${
                      active
                        ? "bg-white/10 text-cyan-300"
                        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                    }`}
                    title={item.hint}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://panta.market"
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-zinc-300 hover:border-cyan-400/40 hover:text-cyan-200 sm:inline"
            >
              Powered by Panta
            </a>
            <WalletMultiButton className="!h-9 !rounded-lg !bg-cyan-500/90 !text-sm !font-semibold !text-slate-950 hover:!bg-cyan-400" />
          </div>
        </div>
        <nav className="flex gap-1 border-t border-white/5 px-4 py-2 md:hidden">
          {nav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/" || pathname.startsWith("/markets")
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs ${
                  active ? "bg-white/10 text-cyan-300" : "text-zinc-400"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-center text-[11px] text-zinc-500">
        Built for the Panta API Sidetrack ·{" "}
        <a
          className="text-cyan-400/80 hover:text-cyan-300"
          href="https://panta.market"
          target="_blank"
          rel="noreferrer"
        >
          Powered by Panta
        </a>{" "}
        · Docs{" "}
        <a
          className="text-cyan-400/80 hover:text-cyan-300"
          href="https://docs.panta.market/"
          target="_blank"
          rel="noreferrer"
        >
          docs.panta.market
        </a>
      </footer>
    </div>
  );
}
