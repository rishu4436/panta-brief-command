"use client";

/**
 * Browser side of community forecasting: same-origin fetchers + TanStack
 * hooks. The server is the only authority: nothing is cached in localStorage
 * and the UI shows a forecast as saved only after the server confirms it.
 */

import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { call } from "@/lib/rooms/client";
import type { Consensus, PublicForecast, PublicRevision } from "./domain";
import type { PublicForecastWindow } from "./window-public";

export type RoomForecastsResponse = {
  roomId: string;
  marketId: string;
  window: PublicForecastWindow;
  consensus: Consensus;
  forecasts: PublicForecast[];
  total: number;
  limit: number;
  offset: number;
};

export type MyForecastResponse = { wallet: string | null; current: PublicForecast | null; history: PublicRevision[] };

export const forecastKeys = {
  room: (slug: string) => ["forecasts", slug] as const,
  page: (slug: string, offset: number, limit: number) => ["forecasts", slug, "page", offset, limit] as const,
  mine: (slug: string, wallet: string | null) => ["forecasts", slug, "me", wallet] as const,
};

const path = (slug: string) => `/api/rooms/${encodeURIComponent(slug)}/forecasts`;

export function useRoomForecasts(slug: string, offset: number, limit: number) {
  return useQuery({
    queryKey: forecastKeys.page(slug, offset, limit),
    queryFn: () => call<RoomForecastsResponse>(`${path(slug)}?limit=${limit}&offset=${offset}`),
    staleTime: 15_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

/** The verified wallet's current forecast + history (null wallet when signed out). */
export function useMyForecast(slug: string, sessionWallet: string | null) {
  return useQuery({
    queryKey: forecastKeys.mine(slug, sessionWallet),
    queryFn: () => call<MyForecastResponse>(`${path(slug)}/me`),
    enabled: Boolean(sessionWallet),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useApplyCommittedForecast(slug: string) {
  const qc = useQueryClient();
  return (res: SubmitForecastResponse) => applyCommittedForecast(qc, slug, res);
}

export function useInvalidateForecasts(slug: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: forecastKeys.room(slug) });
}

export type SubmitForecastBody = {
  roomId: string;
  probabilityBps: number;
  reasoning: string;
  expectedRevision: number;
  idempotencyKey: string;
};

export type SubmitForecastResponse = {
  status: "created" | "revised" | "replayed";
  forecast: PublicForecast;
  /** Community aggregate read right after the write (null if that read failed). */
  consensus: Consensus | null;
};

export function submitForecastRequest(slug: string, body: SubmitForecastBody) {
  return call<SubmitForecastResponse>(path(slug), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Put a server-confirmed submission into the query cache, so the panel shows
 * the committed forecast and the committed community aggregate at once (no
 * stale flash, no wait for a refetch). In-flight forecast queries are
 * cancelled first so an older response can't land on top. A background
 * refetch then reconciles everything else.
 */
export async function applyCommittedForecast(qc: QueryClient, slug: string, res: SubmitForecastResponse): Promise<void> {
  await qc.cancelQueries({ queryKey: forecastKeys.room(slug) });
  const f = res.forecast;
  const rev: PublicRevision = { revision: f.revision, probabilityBps: f.probabilityBps, reasoning: f.reasoning, createdAt: f.updatedAt };
  qc.setQueryData<MyForecastResponse>(forecastKeys.mine(slug, f.wallet), (old) => {
    const prior = old?.wallet === f.wallet ? old.history : [];
    const keepCurrent = old?.current && old.current.revision > f.revision ? old.current : f;
    const history = [rev, ...prior.filter((h) => h.revision !== f.revision)].sort((a, b) => b.revision - a.revision);
    return { wallet: f.wallet, current: keepCurrent, history };
  });
  qc.setQueriesData<RoomForecastsResponse>({ queryKey: [...forecastKeys.room(slug), "page"] }, (old) => {
    if (!old) return old;
    const present = old.forecasts.some((x) => x.wallet === f.wallet);
    let forecasts = old.forecasts;
    if (old.offset === 0) {
      // Listing is most-recently-updated first: the committed forecast leads page 1.
      forecasts = [f, ...old.forecasts.filter((x) => x.wallet !== f.wallet)].slice(0, old.limit);
    } else if (present) {
      forecasts = old.forecasts.map((x) => (x.wallet === f.wallet ? f : x));
    }
    const total = res.consensus ? res.consensus.participants : res.status === "created" && !present ? old.total + 1 : old.total;
    return { ...old, consensus: res.consensus ?? old.consensus, forecasts, total };
  });
  void qc.invalidateQueries({ queryKey: forecastKeys.room(slug) });
}
