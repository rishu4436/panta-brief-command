"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import type { ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";

const nav = [
  { href: "/desk", label: "Desk", match: (p: string) => p === "/desk" || p.startsWith("/markets") },
  { href: "/execute", label: "Execute", match: (p: string) => p.startsWith("/execute") },
  { href: "/book", label: "Book", match: (p: string) => p.startsWith("/book") },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-100">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-[#1f1f23] bg-[#0a0a0b]/95 backdrop-blur-md">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-5">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-cyan-400 text-[10px] font-black text-[#0a0a0b]">
                P
              </span>
              <span className="text-[13px] font-semibold tracking-tight text-zinc-50">
                Panta<span className="text-zinc-400">Brief</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
              {nav.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                      active
                        ? "bg-[#161618] text-zinc-50"
                        : "text-zinc-400 hover:bg-[#161618] hover:text-zinc-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("panta-brief-cmdk"))}
              className="hidden items-center gap-1.5 rounded-md border border-[#1f1f23] bg-[#111113] px-2 py-1 font-num text-[10px] text-zinc-500 transition hover:border-[#2a2a2e] hover:text-zinc-300 sm:inline-flex"
              title="Jump to market (⌘K)"
              aria-label="Open command palette"
            >
              ⌘K
            </button>
            <a
              href="https://panta.market"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-full border border-[#1f1f23] bg-[#111113] px-2.5 py-1 text-[10px] text-zinc-400 transition hover:border-[#2a2a2e] hover:text-zinc-200 sm:inline-flex"
            >
              Powered by Panta
            </a>
            {!isLanding && (
              <span className="hidden items-center gap-1.5 rounded-full border border-[#1f1f23] bg-[#111113] px-2.5 py-1 text-[11px] text-zinc-400 sm:inline-flex">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Live
              </span>
            )}
            {isLanding ? (
              <Link
                href="/desk"
                className="rounded-md bg-cyan-400 px-3 py-1.5 text-[12px] font-semibold text-[#0a0a0b] transition hover:bg-cyan-300 active:scale-[0.98]"
              >
                Open desk
              </Link>
            ) : (
              <WalletMultiButton />
            )}
          </div>
        </div>

        <nav className="flex gap-1 border-t border-[#1f1f23] px-3 py-1.5 md:hidden" aria-label="Mobile">
          <Link
            href="/"
            className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs ${
              isLanding ? "bg-[#161618] text-zinc-50" : "text-zinc-500"
            }`}
          >
            Home
          </Link>
          {nav.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs ${
                  active ? "bg-[#161618] text-zinc-50" : "text-zinc-500"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-[1400px] px-4 py-5">
        {children}
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-6 pt-2 text-center text-[10px] text-zinc-500">
        Powered by{" "}
        <a
          className="text-zinc-400 hover:text-cyan-400"
          href="https://panta.market"
          target="_blank"
          rel="noreferrer"
        >
          Panta
        </a>{" "}
        ·{" "}
        <a
          className="text-zinc-400 hover:text-cyan-400"
          href="https://docs.panta.market/"
          target="_blank"
          rel="noreferrer"
        >
          Docs
        </a>
      </footer>

      <CommandPalette />
    </div>
  );
}
