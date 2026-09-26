"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";
import { Footer } from "./Footer";
import { isMarketingPath, TopNavigation } from "./TopNavigation";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const marketing = isMarketingPath(pathname);
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <TopNavigation />
      <main id="main" className={marketing ? "w-full flex-1" : "mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6"}>
        {children}
      </main>
      <Footer variant={marketing ? "marketing" : "app"} />
      {!marketing && <CommandPalette />}
    </div>
  );
}
