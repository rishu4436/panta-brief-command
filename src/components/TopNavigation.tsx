"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { useRecents } from "@/hooks/useLocalIds";
import { buildNavItems, desktopEntries, isMarketingPath, type NavItem } from "@/lib/navigation";
import { BrandMark } from "./BrandMark";
import { WalletButton } from "./WalletButton";
import { IconArrowRight, IconChevronDown, IconClose, IconMenu } from "./ui/Icons";

export { isMarketingPath };

function useNavItems(): { marketing: boolean; items: NavItem[] } {
  const pathname = usePathname();
  const sp = useSearchParams();
  const { ids: recentIds } = useRecents();
  return buildNavItems({ pathname, tab: sp.get("tab"), recentMarketId: recentIds[0] ?? null });
}

function Brand() {
  return (
    <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2.5" aria-label="Brief Command home">
      <BrandMark className="h-7 w-7" />
      <span className="text-[15px] font-bold tracking-[0.08em] text-ink">BRIEF COMMAND</span>
    </Link>
  );
}

const barItemClass = (active: boolean) =>
  `type-nav relative flex h-16 items-center whitespace-nowrap px-2.5 transition-colors xl:px-3 ${active ? "text-ink" : "text-ink-2 hover:text-ink"}`;

function ActiveBar({ active }: { active: boolean }) {
  return <span aria-hidden="true" className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full transition-opacity ${active ? "bg-cyan-400 opacity-100" : "opacity-0"}`} />;
}

/**
 * Disclosure menu in the desktop bar: a button (aria-expanded/aria-controls)
 * revealing a list of links. Opens on click, Enter/Space or ArrowDown; Escape
 * closes and returns focus to the button; clicking outside, tabbing away or
 * navigating closes it. The panel is right-aligned so it never extends past the
 * bar's right edge (the bar clips horizontally; see DesktopLinks).
 */
function NavMenu({ label, items, active, className = "" }: { label: string; items: NavItem[]; active: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  const rootRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const focusLink = (index: number) => {
    const links = rootRef.current?.querySelectorAll<HTMLElement>(`[data-nav-menu-link]`);
    if (!links?.length) return;
    links[(index + links.length) % links.length]?.focus();
  };

  return (
    <li
      ref={rootRef}
      className={`relative ${className}`}
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => focusLink(0));
          }
        }}
        className={`${barItemClass(active)} gap-1`}
      >
        {label}
        {active ? <span className="sr-only"> (current section)</span> : null}
        <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        <ActiveBar active={active} />
      </button>
      <ul
        id={panelId}
        hidden={!open}
        onKeyDown={(e) => {
          const links = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(`[data-nav-menu-link]`) ?? []);
          const i = links.indexOf(document.activeElement as HTMLElement);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            focusLink(i + 1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            focusLink(i - 1);
          }
        }}
        className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-line bg-surface p-1.5 shadow-2xl"
      >
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              data-nav-menu-link=""
              aria-current={item.active ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={`flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-[14px] font-medium ${
                item.active ? "bg-elevated text-ink" : "text-ink-2 hover:bg-elevated hover:text-ink"
              }`}
            >
              {item.label}
              {item.active ? <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden="true" /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Desktop bar. The <ul> clips horizontally (overflow-x: clip, overflow-y stays
 * visible for the menus) and may shrink (min-w-0), so even if a future item
 * doesn't fit it is cut off inside the bar instead of sliding under the
 * search button or wallet chip.
 */
function DesktopLinks() {
  const { items } = useNavItems();
  return (
    <ul className="flex min-w-0 items-center gap-0.5 overflow-x-clip xl:gap-1" data-nav-bar="">
      {desktopEntries(items).map((entry) =>
        entry.kind === "menu" ? (
          <NavMenu key={entry.group} label={entry.label} items={entry.items} active={entry.active} className={entry.belowXl ? "xl:hidden" : ""} />
        ) : (
          <li key={entry.item.label} className={entry.xlOnly ? "hidden xl:block" : undefined}>
            <Link href={entry.item.href} aria-current={entry.item.active ? "page" : undefined} className={barItemClass(entry.item.active)}>
              {entry.item.label}
              <ActiveBar active={entry.item.active} />
            </Link>
          </li>
        ),
      )}
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
        <div className={`flex min-w-0 items-center ${marketing ? "gap-8" : "gap-4 xl:gap-8"}`}>
          <Brand />
          {!marketing && (
            <nav aria-label="Desk" className="hidden min-w-0 lg:block">
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
        <div className="flex shrink-0 items-center gap-2.5">
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
                className="hidden h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-surface px-3 text-[12px] text-ink-3 transition hover:text-ink lg:inline-flex"
                aria-label="Search markets (Command K)"
              >
                <span className="xl:hidden">Search</span>
                <span className="hidden xl:inline">Search markets</span>
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
