import "server-only";

/**
 * Arena read models (public, read-only): rankings, room leaderboards and
 * forecaster profiles. Nothing here writes, fetches resolution evidence or
 * reveals an outcome that hasn't been finalized.
 */

import { consensusFrom, serializeForecast, serializeRevision, type PublicForecast, type PublicRevision } from "@/lib/forecasts/domain";
import { peekCatalog } from "@/lib/panta/catalog-server";
import { marketLabel } from "@/lib/format";
import type { RoomRecord } from "@/lib/rooms/domain";
import type { RoomRepository } from "@/lib/rooms/store/types";
import { ARENA_METHODOLOGY, isListedRoom, publicForecasterRow, publicScore, type PublicForecasterRow, type PublicScore } from "./public";
import { reputationView } from "./scoring";

export const ARENA_PAGE_MAX = 50;
const PROFILE_ROOMS_MAX = 25;
const PROFILE_REVISIONS_MAX = 20;

/** Market title from the already-built catalog (never waits, never calls Panta). */
export function catalogTitle(marketId: string): string | null {
  try {
    const row = peekCatalog()?.payload.items.find((m) => m.marketId === marketId);
    return row ? marketLabel(row, { max: 120 }) : null;
  } catch {
    return null;
  }
}

export async function arenaPage(repo: RoomRepository, tier: "ranked" | "provisional", limit: number, offset: number) {
  const page = await repo.listForecasters({ tier, limit, offset });
  const pending = await repo.countPendingMarkets(page.items.map((r) => r.wallet));
  const items: PublicForecasterRow[] = page.items.map((r, i) => publicForecasterRow(r, tier === "ranked" ? offset + i + 1 : null, pending[r.wallet] ?? null));
  return { tier, items, total: page.total, limit, offset, methodology: ARENA_METHODOLOGY };
}

export type RoomLeaderboard =
  | { status: "in_progress"; message: string; pending: { forecasts: PublicForecast[]; total: number; limit: number; offset: number; participants: number } }
  | { status: "blocked"; message: string; finalizedAt: string; pending: { forecasts: PublicForecast[]; total: number; limit: number; offset: number; participants: number } }
  | {
      status: "scored";
      outcome: "yes" | "no";
      finalizedAt: string;
      cutoffAt: string;
      provenance: { panta: { status: string; fetchedAt: string }; chain: { status: string; slot: number | null; account: string; fetchedAt: string } };
      scores: (PublicScore & { rank: number; wallet: string })[];
      total: number;
      limit: number;
      offset: number;
    };

export const IN_PROGRESS_TEXT = "Forecasting competition in progress — scores available after verified resolution.";
export const BLOCKED_TEXT =
  "Resolution sources disagree (Panta's market record vs the on-chain market account), so this market is blocked pending reconciliation. No scores have been given.";

export async function roomLeaderboard(repo: RoomRepository, room: RoomRecord, limit: number, offset: number): Promise<RoomLeaderboard> {
  const fin = await repo.getFinalization(room.marketId);
  if (fin && fin.status === "scored" && fin.outcome && fin.cutoffAt !== null) {
    const page = await repo.listRoomScores(room.roomId, { limit, offset });
    const title = catalogTitle(room.marketId);
    return {
      status: "scored",
      outcome: fin.outcome,
      finalizedAt: new Date(fin.finalizedAt).toISOString(),
      cutoffAt: new Date(fin.cutoffAt).toISOString(),
      provenance: {
        panta: { status: fin.provenance.panta.status, fetchedAt: fin.provenance.panta.fetchedAt },
        chain: { status: fin.provenance.chain.status, slot: fin.provenance.chain.slot, account: fin.provenance.chain.account, fetchedAt: fin.provenance.chain.fetchedAt },
      },
      scores: page.items.map((s, i) => ({ ...publicScore(s, room, title), rank: offset + i + 1, wallet: s.wallet })),
      total: page.total,
      limit,
      offset,
    };
  }
  const [list, agg] = await Promise.all([repo.listCurrentForecasts(room.roomId, { limit, offset }), repo.getForecastAggregate(room.roomId)]);
  const pending = { forecasts: list.items.map(serializeForecast), total: list.total, limit, offset, participants: consensusFrom(agg).participants };
  if (fin && fin.status === "blocked") return { status: "blocked", message: BLOCKED_TEXT, finalizedAt: new Date(fin.finalizedAt).toISOString(), pending };
  return { status: "in_progress", message: IN_PROGRESS_TEXT, pending };
}

export type ProfileRoom = {
  roomId: string;
  roomSlug: string | null;
  roomTitle: string | null;
  marketId: string;
  marketTitle: string | null;
  marketStatus: "pending" | "scored" | "blocked";
  current: PublicForecast | null;
  revisions: PublicRevision[];
  roomScore: PublicScore | null;
  countsGlobally: boolean;
};

export async function forecasterProfile(repo: RoomRepository, wallet: string, scoresLimit: number, scoresOffset: number) {
  const [rep, rank, pending, scores, rooms] = await Promise.all([
    repo.getReputation(wallet),
    repo.getRank(wallet),
    repo.countPendingMarkets([wallet]),
    repo.listGlobalScores(wallet, { limit: scoresLimit, offset: scoresOffset }),
    repo.listWalletRooms(wallet, { limit: PROFILE_ROOMS_MAX }),
  ]);
  const roomCache = new Map<string, RoomRecord | null>();
  const roomOf = async (id: string) => {
    if (!roomCache.has(id)) roomCache.set(id, await repo.getRoomById(id));
    return roomCache.get(id) ?? null;
  };
  const recent: PublicScore[] = [];
  for (const s of scores.items) recent.push(publicScore(s, await roomOf(s.roomId), catalogTitle(s.marketId)));

  const profileRooms: ProfileRoom[] = [];
  for (const wr of rooms) {
    const room = await roomOf(wr.roomId);
    if (!room) continue;
    const listed = isListedRoom(room);
    const [current, history, fin, roomScore, globalScore] = await Promise.all([
      repo.getCurrentForecast(wr.roomId, wallet),
      repo.getForecastHistory(wr.roomId, wallet, { limit: PROFILE_REVISIONS_MAX }),
      repo.getFinalization(wr.marketId),
      repo.getRoomScore(wr.roomId, wallet),
      repo.getGlobalScore(wallet, wr.marketId),
    ]);
    if (!current) continue;
    const title = catalogTitle(wr.marketId);
    profileRooms.push({
      roomId: wr.roomId,
      roomSlug: listed ? room.slug : null,
      roomTitle: listed ? room.title : null,
      marketId: wr.marketId,
      marketTitle: title,
      marketStatus: fin?.status === "scored" ? "scored" : fin?.status === "blocked" ? "blocked" : "pending",
      current: serializeForecast(current),
      revisions: history.map(serializeRevision),
      roomScore: roomScore && fin?.status === "scored" ? publicScore(roomScore, room, title) : null,
      countsGlobally: Boolean(roomScore && globalScore && globalScore.scoreId === roomScore.scoreId),
    });
  }
  return {
    wallet,
    reputation: rep ? publicForecasterRow(rep, rank, pending[wallet] ?? 0) : null,
    rankedThreshold: ARENA_METHODOLOGY.minRankedMarkets,
    scoredMarkets: rep ? reputationView(rep).scoredCount : 0,
    pendingMarkets: pending[wallet] ?? 0,
    scores: { items: recent, total: scores.total, limit: scoresLimit, offset: scoresOffset },
    rooms: profileRooms,
    methodology: ARENA_METHODOLOGY,
  };
}
