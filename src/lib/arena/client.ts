"use client";

/** Browser side of the arena: read-only fetchers + TanStack hooks. */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { forecastKeys } from "@/lib/forecasts/client";
import { call } from "@/lib/rooms/client";
import type { PublicForecasterRow } from "./public";
import type { forecasterProfile, RoomLeaderboard } from "./service";

export type ArenaMethodology = { minRankedMarkets: number; priorScore: string; priorWeight: number };
export type ArenaPageResponse = { tier: "ranked" | "provisional"; items: PublicForecasterRow[]; total: number; limit: number; offset: number; methodology: ArenaMethodology };
export type RoomLeaderboardResponse = RoomLeaderboard & { roomId: string; marketId: string };
export type ForecasterProfileResponse = Awaited<ReturnType<typeof forecasterProfile>>;

export const arenaKeys = {
  page: (tier: string, offset: number, limit: number) => ["arena", tier, offset, limit] as const,
  profile: (wallet: string, offset: number) => ["forecaster", wallet, offset] as const,
  // Under the room's forecast key so a saved forecast refreshes the pending list too.
  leaderboard: (slug: string, offset: number) => [...forecastKeys.room(slug), "leaderboard", offset] as const,
};

export function useArenaPage(tier: "ranked" | "provisional", offset: number, limit: number) {
  return useQuery({
    queryKey: arenaKeys.page(tier, offset, limit),
    queryFn: () => call<ArenaPageResponse>(`/api/arena?tier=${tier}&limit=${limit}&offset=${offset}`),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useRoomLeaderboard(slug: string, offset: number) {
  return useQuery({
    queryKey: arenaKeys.leaderboard(slug, offset),
    queryFn: () => call<RoomLeaderboardResponse>(`/api/rooms/${encodeURIComponent(slug)}/leaderboard?limit=20&offset=${offset}`),
    staleTime: 30_000,
    refetchInterval: 120_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useForecasterProfile(wallet: string, offset: number) {
  return useQuery({
    queryKey: arenaKeys.profile(wallet, offset),
    queryFn: () => call<ForecasterProfileResponse>(`/api/forecasters/${encodeURIComponent(wallet)}?limit=20&offset=${offset}`),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}
