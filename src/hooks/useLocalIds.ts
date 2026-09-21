"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getRecents,
  getWatchlist,
  notifyStorage,
  pushRecent,
  subscribeStorage,
  toggleWatch,
} from "@/lib/storage";

export function useWatchlist() {
  const [ids, setIds] = useState<string[]>([]);

  const sync = useCallback(() => setIds(getWatchlist()), []);

  useEffect(() => {
    sync();
    return subscribeStorage(sync);
  }, [sync]);

  const toggle = useCallback((marketId: string) => {
    const next = toggleWatch(marketId);
    notifyStorage();
    setIds(next);
    return next;
  }, []);

  return { ids, toggle, has: (id: string) => ids.includes(id) };
}

export function useRecents() {
  const [ids, setIds] = useState<string[]>([]);

  const sync = useCallback(() => setIds(getRecents()), []);

  useEffect(() => {
    sync();
    return subscribeStorage(sync);
  }, [sync]);

  const push = useCallback((marketId: string) => {
    const next = pushRecent(marketId);
    notifyStorage();
    setIds(next);
    return next;
  }, []);

  return { ids, push };
}
