"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { BrandMark } from "./BrandMark";
import { WalletButton } from "./WalletButton";
import { IconArrowRight, IconClose, IconMenu } from "./ui/Icons";

type NavItem = { href: string; label: string; active: boolean };

export function isMarketingPath(pathname: string) {
  return pathname === "/" || pathname === "/about";
}

function useNavItems(): { marketing: boolean; items: NavItem[] } {
  const pathname = usePathname();
  const sp = useSearchParams();
  const marketing = isMarketingPath(pathname);
  if (marketing) {
    return {
      marketing,
      items: [
        { href: "/", label: "Home", active: pathname === "/" },
        { href: "/execute", label: "Trade", active: false },
        { href: "/desk", label: "Markets", active: false },
        { href: "/about", label: "About", active: pathname === "/about" },
      ],
    };
  }
  const onMarket = pathname.startsWith("/markets/");
  const tab = sp.get("tab");
  return {
    marketing,
    items: [
      { href: "/desk", label: "Markets", active: pathname === "/desk" || onMarket },
      // The brief lives beside the selected market in the workspace.
      { href: onMarket ? `${pathname}#brief` : "/desk#brief", label: "Briefs", active: false },
      { href: "/execute", label: "Trade", active: pathname.startsWith("/execute") },
      { href: "/book?tab=positions", label: "Positions", active: pathname.startsWith("/book") && tab !== "activity" && tab !== "claims" },
      { href: "/book?tab=activity", label: "Activity", active: pathname.startsWith("/book") && tab === "activity" },
    ],
  };
}

function Brand() {
  return (
    <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2.5" aria-label="Brief Command home">
      <BrandMark className="h-7 w-7" />
      <span className="text-[15px] font-bold tracking-[0.08em] text-ink">BRIEF COMMAND</span>
    </Link>
  );
}

function DesktopLinks() {
  const { items } = useNavItems();
  return (
    <ul className="flex items-center gap-1">
      {items.map((item) => (
        <li key={item.label}>
          <Link
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={`type-nav relative flex h-16 items-center px-3 transition-colors ${
              item.active ? "text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            {item.label}
            <span
              aria-hidden="true"
              className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full transition-opacity ${
                item.active ? "bg-cyan-400 opacity-100" : "opacity-0"
              }`}
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MobileNavigation({ marketing }: { marketing: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={marketing ? "md:hidden" : "lg:hidden"}>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-ink"
      >
        {open ? <IconClose /> : <IconMenu />}
      </button>
      {open && (
        <div
          id="mobile-nav"
          ref={panelRef}
          className="absolute inset-x-0 top-full border-b border-line bg-bg/97 px-4 pb-5 pt-2 shadow-2xl backdrop-blur-xl animate-fade-in"
        >
          <Suspense fallback={null}>
            <MobileLinks />
          </Suspense>
          <div className="mt-3 border-t border-line pt-4">
            {marketing ? (
              <Link href="/desk" className="btn btn-primary btn-lg w-full">
                Open Trading Desk <IconArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <WalletButton block />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileLinks() {
  const { items } = useNavItems();
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.label}>
          <Link
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={`flex min-h-[48px] items-center justify-between rounded-lg px-3 text-[15px] font-medium ${
              item.active ? "bg-elevated text-ink" : "text-ink-2 hover:bg-elevated hover:text-ink"
            }`}
          >
            {item.label}
            {item.active ? <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden="true" /> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TopNavigation() {
  const pathname = usePathname();
  const marketing = isMarketingPath(pathname);
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/75 backdrop-blur-xl">
      <div className={`relative mx-auto flex h-16 items-center justify-between gap-4 px-4 sm:px-6 ${marketing ? "max-w-[1280px]" : "max-w-[1600px]"}`}>
        <div className="flex min-w-0 items-center gap-8">
          <Brand />
          {!marketing && (
            <nav aria-label="Desk" className="hidden lg:block">
              <Suspense fallback={null}>
                <DesktopLinks />
              </Suspense>
            </nav>
          )}
        </div>
        {marketing && (
          <nav aria-label="Primary" className="absolute left-1/2 hidden -translate-x-1/2 md:block">
            <Suspense fallback={null}>
              <DesktopLinks />
            </Suspense>
          </nav>
        )}
        <div className="flex items-center gap-2.5">
          {marketing ? (
            <>
              <a
                href="https://docs.panta.market/"
                target="_blank"
                rel="noreferrer"
                className="hidden items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[12px] text-ink-2 transition hover:text-ink xl:inline-flex"
              >
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                Powered by Panta API · Solana
              </a>
              <Link href="/desk" className="btn btn-primary hidden md:inline-flex">
                Open Trading Desk
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("panta-brief-cmdk"))}
                className="hidden h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[12px] text-ink-3 transition hover:text-ink lg:inline-flex"
                aria-label="Search markets (Command K)"
              >
                Search markets
                <kbd className="rounded border border-line px-1 font-sans text-[10px]">⌘K</kbd>
              </button>
              <div className="hidden lg:block">
                <WalletButton />
              </div>
            </>
          )}
          <MobileNavigation marketing={marketing} />
        </div>
      </div>
    </header>
  );
}
