"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "@/lib/rooms/client";
import type { Room, RoomStatus, RoomVisibility } from "@/lib/rooms/domain";
import type { StudioOverview, StudioRoomAnalytics, StudioRoomsPage } from "./domain";

export type StudioRoomsQuery = { q: string; status: "all" | "active" | "archived" | "public" | "unlisted"; page: number };

export const studioKeys = {
  all: ["studio"] as const,
  overview: (wallet: string) => ["studio", "overview", wallet] as const,
  rooms: (wallet: string, p: StudioRoomsQuery) => ["studio", "rooms", wallet, p.q, p.status, p.page] as const,
  room: (wallet: string, slug: string) => ["studio", "room", wallet, slug] as const,
};

/** The wallet is part of the cache key only; the server answers for the session wallet. */
export function useStudioOverview(wallet: string | null) {
  return useQuery({
    queryKey: studioKeys.overview(wallet ?? "-"),
    queryFn: () => call<StudioOverview>("/api/studio/overview"),
    enabled: Boolean(wallet),
    staleTime: 20_000,
    retry: 1,
  });
}

export function useStudioRooms(wallet: string | null, p: StudioRoomsQuery) {
  return useQuery({
    queryKey: studioKeys.rooms(wallet ?? "-", p),
    queryFn: () => call<StudioRoomsPage>(`/api/studio/rooms?${new URLSearchParams({ q: p.q, status: p.status, page: String(p.page) })}`),
    enabled: Boolean(wallet),
    staleTime: 20_000,
    retry: 1,
    placeholderData: (prev) => prev,
  });
}

export function useStudioRoom(wallet: string | null, slug: string) {
  return useQuery({
    queryKey: studioKeys.room(wallet ?? "-", slug),
    queryFn: () => call<StudioRoomAnalytics>(`/api/studio/rooms/${encodeURIComponent(slug)}`),
    enabled: Boolean(wallet),
    staleTime: 20_000,
    retry: (n, e) => n < 1 && !(e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404),
  });
}

export function useInvalidateStudio() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: studioKeys.all }), qc.invalidateQueries({ queryKey: ["rooms", "list"] })]);
}

export type RoomSettingsPatch = { title?: string; description?: string; visibility?: RoomVisibility; status?: RoomStatus };

/** PATCH /api/rooms/:slug (same-origin, session cookie). The server checks the session wallet is the creator. */
export function updateRoomSettings(slug: string, patch: RoomSettingsPatch): Promise<{ room: Room }> {
  return call<{ room: Room }>(`/api/rooms/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify(patch) });
}
