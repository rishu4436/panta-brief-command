"use client";

import type { MouseEvent } from "react";
import { useWatchlist } from "@/hooks/useLocalIds";

export function WatchStar({
  marketId,
  size = "md",
}: {
  marketId: string;
  size?: "sm" | "md";
}) {
  const watch = useWatchlist();
  const on = watch.has(marketId);

  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    watch.toggle(marketId);
  };

  const dim = size === "sm" ? "h-7 w-7 text-[13px]" : "h-8 w-8 text-[15px]";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      title={on ? "Unwatch" : "Watch"}
      className={`tap-target inline-flex shrink-0 items-center justify-center rounded-md border transition active:scale-[0.96] ${dim} ${
        on
          ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
          : "border-line bg-inset text-zinc-500 hover:border-line-strong hover:text-zinc-300"
      }`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
