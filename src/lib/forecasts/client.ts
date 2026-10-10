"use client";

/**
 * Browser side of community forecasting: same-origin fetchers + TanStack
 * hooks. The server is the only authority: nothing is cached in localStorage
 * and the UI shows a forecast as saved only after the server confirms it.
 */

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function submitForecastRequest(slug: string, body: SubmitForecastBody) {
  return call<{ status: "created" | "revised" | "replayed"; forecast: PublicForecast }>(path(slug), {
    method: "POST",
    body: JSON.stringify(body),
  });
}
