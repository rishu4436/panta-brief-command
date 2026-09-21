"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import {
  isWatched,
  notifyStorage,
  subscribeStorage,
  toggleWatch,
} from "@/lib/storage";

export function WatchStar({
  marketId,
  size = "md",
}: {
  marketId: string;
  size?: "sm" | "md";
}) {
  const [on, setOn] = useState(false);

  const sync = useCallback(() => {
    setOn(isWatched(marketId));
  }, [marketId]);

  useEffect(() => {
    sync();
    return subscribeStorage(sync);
  }, [sync]);

  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWatch(marketId);
    notifyStorage();
    sync();
  };

  const dim = size === "sm" ? "h-7 w-7 text-[13px]" : "h-8 w-8 text-[15px]";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      title={on ? "Unwatch" : "Watch"}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border transition active:scale-[0.96] ${dim} ${
        on
          ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
          : "border-[#1f1f23] bg-[#0a0a0b] text-zinc-500 hover:border-[#2a2a2e] hover:text-zinc-300"
      }`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
