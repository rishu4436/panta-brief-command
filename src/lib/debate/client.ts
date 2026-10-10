"use client";

/** Browser side of the AI Debate Arena: same-origin fetchers + TanStack hooks. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call, newIdempotencyKey } from "@/lib/rooms/client";
import type { DebateChallenge } from "./domain";
import type { DebateView } from "./service";

export type DebateViewResponse = DebateView & { roomId: string; viewer: { verified: boolean } };

export const debateKeys = {
  view: (slug: string, debateId: string | null) => ["rooms", slug, "debate", debateId ?? "latest"] as const,
  all: (slug: string) => ["rooms", slug, "debate"] as const,
};

export function useDebate(slug: string, debateId: string | null) {
  return useQuery({
    queryKey: debateKeys.view(slug, debateId),
    queryFn: () => call<DebateViewResponse>(`/api/rooms/${encodeURIComponent(slug)}/debate${debateId ? `?debate=${encodeURIComponent(debateId)}` : ""}`),
    staleTime: 20_000,
    retry: 1,
    // While another request is generating, check back until it lands.
    refetchInterval: (q) => (q.state.data?.generating ? 5_000 : false),
  });
}

export function useGenerateDebate(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      call<{ status: "created" | "reused"; debateId: string }>(`/api/rooms/${encodeURIComponent(slug)}/debate`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: debateKeys.all(slug) }),
  });
}

export type ChallengeRequest = { debateId: string; claimId: string; text: string; sourceUrl: string | null; idempotencyKey: string };

export function useChallengeClaim(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChallengeRequest) =>
      call<{ status: "created" | "replayed"; challenge: DebateChallenge }>(`/api/rooms/${encodeURIComponent(slug)}/debate/challenges`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: debateKeys.all(slug) }),
  });
}

export { newIdempotencyKey };
